import type { MeshNodeProps } from "../types";
import { useEffect, useRef, useState } from "react";
import { loadAsr, openMic, type LoadEvent, type MicRecorder } from "../embed";

type Phase = "idle" | "loading" | "ready" | "recording" | "transcribing" | "done" | "error";

export function WhisperEar(_props: MeshNodeProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const micRef = useRef<MicRecorder | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      micRef.current?.close();
      micRef.current = null;
    };
  }, []);

  // Waveform loop runs only while the mic is live.
  useEffect(() => {
    if (phase !== "recording") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const bars = 56;
    const history = new Array<number>(bars).fill(0);
    const started = performance.now();
    const draw = () => {
      if (phaseRef.current !== "recording") return;
      const level = micRef.current?.level() ?? 0;
      history.push(level);
      history.shift();
      setSeconds((performance.now() - started) / 1000);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = Math.min(1, history[i] * 1.7);
        const bh = Math.max(2 * dpr, v * (h - 8));
        ctx.fillStyle =
          i > bars - 6 ? "rgba(200, 255, 22, 0.95)" : "rgba(200, 255, 22, 0.55)";
        ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 2.5, bh);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  const startHold = async () => {
    if (phase === "recording") return;
    setError("");
    try {
      if (phase === "idle" || phase === "done") {
        setPhase("loading");
        await loadAsr((event) => {
          setLoads((prev) => ({ ...prev, [event.file]: event }));
        });
      }
      micRef.current ??= await openMic();
      await micRef.current.start();
      setSeconds(0);
      setPhase("recording");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes("permission")
            ? "MIC PERMISSION DENIED — ALLOW THE MICROPHONE AND HOLD AGAIN."
            : err.message.slice(0, 160)
          : "could not open the mic",
      );
      setPhase("error");
    }
  };

  const endHold = async () => {
    const mic = micRef.current;
    if (!mic || phase !== "recording") return;
    setPhase("transcribing");
    try {
      const pcm = await mic.stop();
      if (pcm.length < 3200) {
        setText("— too short to read —");
        setPhase("ready");
        return;
      }
      const asr = await loadAsr();
      const out = await asr.transcribe(pcm);
      setText(out || "— silence —");
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "transcribe failed");
      setPhase("error");
    }
  };

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  const holding = phase === "recording";
  const label =
    phase === "idle"
      ? "HOLD TO ARM + TALK"
      : phase === "loading"
        ? `LOADING WHISPER · ${modelPct}%`
        : phase === "recording"
          ? `LISTENING · ${seconds.toFixed(1)}s — RELEASE TO READ`
          : phase === "transcribing"
            ? "TRANSCRIBING OFFLINE…"
            : phase === "done"
              ? "HOLD AGAIN FOR ANOTHER PASS"
              : "HOLD TO TALK";

  return (
    <div className="mesh-preview">
      <button
        type="button"
        className={`mesh-ear ${holding ? "mesh-ear--live" : ""}`}
        onPointerDown={() => void startHold()}
        onPointerUp={() => void endHold()}
        onPointerLeave={() => void endHold()}
        data-phase={phase}
      >
        <span className="mesh-ear__ring" aria-hidden="true" />
        <span className="mesh-ear__label">{label}</span>
      </button>

      {holding && <canvas ref={canvasRef} className="mesh-wave" />}
      {phase === "transcribing" && (
        <p className="mesh-build">WHISPER IS READING THE WAVEFORM · WASM SIMD</p>
      )}

      {phase === "loading" && loadList.length > 0 && (
        <div className="mesh-loads">
          {loadList.map((event) => (
            <div key={event.file} className="mesh-load">
              <span>{event.file}</span>
              <div className="mesh-load__bar">
                <i style={{ width: `${event.pct}%` }} />
              </div>
              <b>{event.pct}%</b>
            </div>
          ))}
        </div>
      )}

      {(phase === "done" || (text && phase === "ready")) && (
        <div className="mesh-transcript">
          <span className="mesh-transcript__meta">WHISPER-TINY.EN · LOCAL</span>
          <p>{text}</p>
        </div>
      )}

      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
