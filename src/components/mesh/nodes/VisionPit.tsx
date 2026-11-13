import type { MeshNodeProps } from "../types";
import { useRef, useState } from "react";
import { loadDetector, type Detection, type LoadEvent } from "../embed";

export function VisionPit(_props: MeshNodeProps) {
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [state, setState] = useState<"idle" | "loading" | "scanning" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [scanline, setScanline] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanRaf = useRef(0);

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  const onFile = async (file: File) => {
    setError("");
    setDetections([]);
    setScanline(0);
    const url = URL.createObjectURL(file);
    setSource(url);
    try {
      setState("loading");
      const handle = await loadDetector((event) => setLoads((prev) => ({ ...prev, [event.file]: event })));
      setState("scanning");
      const t0 = performance.now();
      const sweep = () => {
        const t = Math.min(1, (performance.now() - t0) / 900);
        setScanline(t);
        if (t < 1) scanRaf.current = requestAnimationFrame(sweep);
      };
      scanRaf.current = requestAnimationFrame(sweep);
      const found = await handle.detect(url);
      setDetections(found);
      setState("done");
    } catch (err) {
      cancelAnimationFrame(scanRaf.current);
      setError(err instanceof Error ? err.message.slice(0, 160) : "detection failed");
      setState("error");
    }
  };

  return (
    <div className="mesh-preview">
      <div className="mesh-camframe mesh-camframe--static">
        {source && <img src={source} alt="scan subject" className="mesh-cam" />}
        {source && detections.map((detection, i) => {
          const [xmin, ymin, xmax, ymax] = detection.box;
          return (
            <div
              key={`${detection.label}-${i}`}
              className="mesh-box"
              style={{
                left: `${xmin * 100}%`,
                top: `${ymin * 100}%`,
                width: `${(xmax - xmin) * 100}%`,
                height: `${(ymax - ymin) * 100}%`,
                animationDelay: `${i * 120}ms`,
              }}
            >
              <span>
                {detection.label.toUpperCase()} {(detection.score * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
        {source && (state === "scanning" || (state === "loading" && !detections.length)) && (
          <div className="mesh-frame__scan mesh-frame__scan--free" style={{ top: `${scanline * 100}%` }} />
        )}
        {!source && (
          <div className="mesh-cam__gate">
            <button
              type="button"
              className="mesh-cta"
              disabled={state === "loading"}
              onClick={() => inputRef.current?.click()}
            >
              {state === "loading" ? `LOADING YOLOS-TINY · ${modelPct}%` : "DROP A FRAME IN THE PIT"}
            </button>
            <span className="mesh-fine">80 COCO CLASSES · INFERENCE ON THIS MACHINE ONLY.</span>
          </div>
        )}
      </div>

      {detections.length > 0 && (
        <div className="mesh-status__memory mesh-pitlist">
          {detections.slice(0, 6).map((detection, i) => (
            <div key={`${detection.label}-row-${i}`}>
              <span>{detection.label.toUpperCase()}</span>
              <b>{(detection.score * 100).toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}

      {source && state !== "loading" && state !== "scanning" && (
        <div className="mesh-actions">
          <button type="button" className="mesh-cta mesh-cta--slim" onClick={() => inputRef.current?.click()}>
            SCAN ANOTHER FRAME
          </button>
        </div>
      )}

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
