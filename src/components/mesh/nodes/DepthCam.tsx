import type { MeshNodeProps } from "../types";
import { useRef, useState } from "react";
import { loadDepth, type LoadEvent } from "../embed";

type DepthResult = { url: string; width: number; height: number };

export function DepthCam(_props: MeshNodeProps) {
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [state, setState] = useState<"idle" | "loading" | "inferring" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthResult | null>(null);
  const [reveal, setReveal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealRaf = useRef(0);

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  const onFile = async (file: File) => {
    setError("");
    setDepth(null);
    setReveal(0);
    const url = URL.createObjectURL(file);
    setSource(url);
    try {
      setState("loading");
      const handle = await loadDepth((event) => setLoads((prev) => ({ ...prev, [event.file]: event })));
      setState("inferring");
      await new Promise((resolve) => setTimeout(resolve, 60));
      const result = await handle.estimate(url);
      // colorize: near = acid, far = deep blue-black
      const canvas = document.createElement("canvas");
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      const image = ctx.createImageData(result.width, result.height);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < result.data.length; i++) {
        if (result.data[i] < min) min = result.data[i];
        if (result.data[i] > max) max = result.data[i];
      }
      const span = max - min || 1;
      for (let i = 0; i < result.data.length; i++) {
        const t = (result.data[i] - min) / span;
        const inv = 1 - t;
        image.data[i * 4] = Math.round(5 + inv * 195);
        image.data[i * 4 + 1] = Math.round(6 + inv * 249);
        image.data[i * 4 + 2] = Math.round(7 + inv * 15);
        image.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      setDepth({ url: canvas.toDataURL("image/png"), width: result.width, height: result.height });
      setState("done");
      cancelAnimationFrame(revealRaf.current);
      const t0 = performance.now();
      const sweep = () => {
        const t = Math.min(1, (performance.now() - t0) / 1400);
        setReveal(t);
        if (t < 1) revealRaf.current = requestAnimationFrame(sweep);
      };
      revealRaf.current = requestAnimationFrame(sweep);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "depth pass failed");
      setState("error");
    }
  };

  return (
    <div className="mesh-preview">
      <div className="mesh-dual">
        <figure className="mesh-frame">
          <figcaption>SOURCE</figcaption>
          {source ? <img src={source} alt="source" /> : <div className="mesh-frame__empty">DROP A FRAME</div>}
        </figure>
        <figure className="mesh-frame mesh-frame--depth">
          <figcaption>DEPTH PASS</figcaption>
          {depth && (
            <>
              <img src={depth.url} alt="depth map" style={{ clipPath: `inset(0 ${100 - reveal * 100}% 0 0)` }} />
              <div className="mesh-frame__scan" style={{ left: `${reveal * 100}%` }} />
            </>
          )}
          {!depth && <div className="mesh-frame__empty">{state === "inferring" ? "ESTIMATING…" : "—"}</div>}
        </figure>
      </div>

      <div className="mesh-actions">
        <button
          type="button"
          className="mesh-cta mesh-cta--slim"
          disabled={state === "loading" || state === "inferring"}
          onClick={() => inputRef.current?.click()}
        >
          {state === "loading" ? `LOADING DEPTH ANYTHING · ${modelPct}%` : state === "inferring" ? "READING DEPTH…" : "FEED IT A FRAME"}
        </button>
        {depth && <span className="mesh-fine">SCAN {reveal >= 1 ? "COMPLETE" : "RUNNING"} · {depth.width}×{depth.height} DEPTH FIELD</span>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = "";
        }}
      />
      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
