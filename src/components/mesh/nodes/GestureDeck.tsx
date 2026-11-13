import { useEffect, useRef, useState } from "react";
import { loadHands, type VisionHandle } from "../embed";
import type { MeshNodeProps } from "../types";

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [9, 13], [13, 14], [14, 15],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const TIPS = [4, 8, 12, 16, 20];

export function GestureDeck({ onTune }: MeshNodeProps) {
  const [state, setState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [readout, setReadout] = useState("NO HANDS IN FRAME");
  const [fps, setFps] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<VisionHandle | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const tuneRef = useRef(onTune);
  tuneRef.current = onTune;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      handleRef.current?.close();
    };
  }, []);

  const enable = async () => {
    setError("");
    setState("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video element missing");
      video.srcObject = stream;
      await video.play();
      const handle = await loadHands();
      handleRef.current = handle;
      setState("live");
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setError(
        err instanceof Error && /permission|denied/i.test(err.message)
          ? "CAMERA PERMISSION DENIED — ALLOW THE CAMERA AND TRY AGAIN."
          : err instanceof Error
            ? err.message.slice(0, 160)
            : "camera unavailable",
      );
      setState("error");
    }
  };

  // Detection loop: video → landmarks → canvas → gesture state machine.
  useEffect(() => {
    if (state !== "live") return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let lastVideoTime = -1;
    let lastFrames = performance.now();
    let frames = 0;
    let lastTune = 0;
    let palmLatch = false;

    const loop = () => {
      const handle = handleRef.current;
      if (!handle || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const now = performance.now();
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const w = canvas.width;
        const h = canvas.height;
        ctx.save();
        ctx.clearRect(0, 0, w, h);
        // mirrored feed
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();

        const frame = handle.detect(video, now);
        frames++;
        if (now - lastFrames > 500) {
          setFps(Math.round((frames * 1000) / (now - lastFrames)));
          frames = 0;
          lastFrames = now;
        }

        let gesture = "NO HANDS IN FRAME";
        let pinch = 0;

        if (frame.hands.length >= 2) {
          const [a, b] = frame.hands;
          const wa = a.points[0];
          const wb = b.points[0];
          const spread = Math.hypot(wa.x - wb.x, wa.y - wb.y);
          gesture = `TWO HANDS · SPREAD ${(spread * 100).toFixed(0)}`;
          if (now - lastTune > 220) {
            const wind = Math.round(Math.max(40, Math.min(400, 40 + spread * 460)));
            tuneRef.current({ windSpeed: wind });
            lastTune = now;
            gesture = `TWO HANDS · WIND ${wind} KM/H`;
          }
        } else if (frame.hands.length === 1) {
          const points = frame.hands[0].points;
          const dx = points[4].x - points[8].x;
          const dy = points[4].y - points[8].y;
          pinch = Math.max(0, Math.min(1, 1 - Math.hypot(dx, dy) / 0.14));
          // extended fingers ≈ open palm
          const extended = TIPS.filter((tip, i) => {
            const pip = [3, 6, 10, 14, 18][i];
            return Math.hypot(points[tip].x - points[0].x, points[tip].y - points[0].y) >
              Math.hypot(points[pip].x - points[0].x, points[pip].y - points[0].y) * 1.08;
          }).length;
          if (pinch > 0.62) {
            gesture = `PINCH ${(pinch * 100).toFixed(0)} · EXPLODED VIEW`;
            if (now - lastTune > 180) {
              tuneRef.current({ explode: Number(pinch.toFixed(2)) });
              lastTune = now;
            }
          } else if (extended >= 4 && !palmLatch) {
            palmLatch = true;
            gesture = "PALM · ASSEMBLY HOME";
            tuneRef.current({ explode: 0 });
          } else {
            gesture = extended >= 4 ? "PALM" : "HAND READY";
            if (extended < 3) palmLatch = false;
          }
        }
        setReadout(gesture);

        const dpr = w / canvas.getBoundingClientRect().width;
        for (const hand of frame.hands) {
          ctx.lineWidth = 2 * dpr;
          ctx.strokeStyle = "rgba(200, 255, 22, 0.85)";
          for (const [a, b] of CONNECTIONS) {
            const pa = hand.points[a];
            const pb = hand.points[b];
            ctx.beginPath();
            ctx.moveTo((1 - pa.x) * w, pa.y * h);
            ctx.lineTo((1 - pb.x) * w, pb.y * h);
            ctx.stroke();
          }
          for (let i = 0; i < hand.points.length; i++) {
            const p = hand.points[i];
            const joint = TIPS.includes(i);
            ctx.beginPath();
            ctx.arc((1 - p.x) * w, p.y * h, joint ? 4.2 * dpr : 2.4 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = joint ? "rgba(200, 255, 22, 1)" : "rgba(233, 237, 232, 0.9)";
            ctx.fill();
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  return (
    <div className="mesh-preview">
      <div className="mesh-camframe">
        <video ref={videoRef} className="mesh-cam" muted playsInline />
        <canvas ref={canvasRef} className={`mesh-cam__overlay ${state === "live" ? "" : "mesh-cam__overlay--hidden"}`} />
        {state !== "live" && (
          <div className="mesh-cam__gate">
            <button type="button" className="mesh-cta" onClick={() => void enable()} disabled={state === "loading"}>
              {state === "loading" ? "LINKING VISION ENGINE…" : "ENABLE THE CAMERA"}
            </button>
            <span className="mesh-fine">LANDMARKS NEVER LEAVE THIS TAB — NOTHING IS UPLOADED.</span>
          </div>
        )}
        {state === "live" && (
          <div className="mesh-cam__hud">
            <span>{readout}</span>
            <b>{fps} FPS</b>
          </div>
        )}
      </div>
      <p className="mesh-fine">
        PINCH → EXPLODED VIEW · OPEN PALM → SNAP HOME · TWO-HAND SPREAD → WIND
        TUNNEL SPEED. EVERY GESTURE FIRES THE REAL SCENE CONTROLS.
      </p>
      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
