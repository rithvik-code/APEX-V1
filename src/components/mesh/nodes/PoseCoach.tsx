import type { MeshNodeProps } from "../types";
import { useEffect, useRef, useState } from "react";
import { loadPose, type PoseHandle } from "../embed";

const POSE_LINKS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [0, 11], [0, 12],
];

export function PoseCoach(_props: MeshNodeProps) {
  const [state, setState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [readout, setReadout] = useState({ energy: 0, stability: 100, poses: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PoseHandle | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

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
      handleRef.current = await loadPose();
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

  useEffect(() => {
    if (state !== "live") return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let lastVideoTime = -1;
    const prev = new Map<number, { x: number; y: number }>();
    let smoothed = 0;

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
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();

        const poses = handle.detect(video, now);
        let motion = 0;
        for (const pose of poses) {
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = "rgba(200, 255, 22, 0.85)";
          for (const [a, b] of POSE_LINKS) {
            const pa = pose[a];
            const pb = pose[b];
            if (!pa || !pb) continue;
            ctx.beginPath();
            ctx.moveTo((1 - pa.x) * w, pa.y * h);
            ctx.lineTo((1 - pb.x) * w, pb.y * h);
            ctx.stroke();
          }
          for (let i = 0; i < pose.length; i++) {
            const p = pose[i];
            if (!p) continue;
            const x = (1 - p.x) * w;
            const y = p.y * h;
            const before = prev.get(i);
            if (before) motion += Math.hypot(x - before.x, y - before.y);
            prev.set(i, { x, y });
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(233, 237, 232, 0.92)";
            ctx.fill();
          }
        }
        smoothed = smoothed * 0.85 + Math.min(100, motion * 0.9) * 0.15;
        const stability = Math.max(0, 100 - smoothed * 2.4);
        setReadout({
          energy: Math.round(smoothed),
          stability: Math.round(stability),
          poses: poses.length,
        });
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
              {state === "loading" ? "LINKING POSE ENGINE…" : "ENABLE THE CAMERA"}
            </button>
            <span className="mesh-fine">33 KEYPOINTS · TRACKED LOCALLY, NEVER UPLOADED.</span>
          </div>
        )}
        {state === "live" && (
          <div className="mesh-cam__hud">
            <span>
              {readout.poses ? `BODY LOCKED · ENERGY ${readout.energy}` : "STEP INTO FRAME"}
            </span>
            <b>STABILITY {readout.stability}%</b>
          </div>
        )}
      </div>
      <p className="mesh-fine">
        MOTION ENERGY DRIVES THE READOUT — SIT STILL AND STABILITY CLIMBS TOWARD
        100. THAT IS THE SEAT-FITNESS CHECK THE COACH WOULD RUN BEFORE A STINT.
      </p>
      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
