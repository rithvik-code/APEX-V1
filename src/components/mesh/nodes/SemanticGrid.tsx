import type { MeshNodeProps } from "../types";
import { useEffect, useRef, useState } from "react";
import { buildMemoryIndex, hash01, kmeans, type MemoryIndex } from "../memoryIndex";
import type { KnowledgeFact } from "../../../lib/knowledge";

type Star = {
  fact: KnowledgeFact;
  x: number;
  y: number;
  cluster: number;
  sim: number;
  tw: number;
};

export function SemanticGrid(_props: MeshNodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const hoverRef = useRef(-1);
  const [status, setStatus] = useState<"cold" | "building" | "live" | "error">("cold");
  const [pct, setPct] = useState(0);
  const [picked, setPicked] = useState<KnowledgeFact | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "live") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, rect.width) * dpr;
      canvas.height = Math.max(260, rect.height) * dpr;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      t += 0.016;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.42;
      ctx.clearRect(0, 0, w, h);

      // core
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, 10 + pulse * 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200, 255, 22, 0.9)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 18 + pulse * 9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200, 255, 22, ${0.35 - pulse * 0.22})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      const stars = starsRef.current;
      const clusterAngles = new Map<number, number>();
      const clusterCounts = new Map<number, number>();
      for (const star of stars) {
        clusterCounts.set(star.cluster, (clusterCounts.get(star.cluster) ?? 0) + 1);
      }
      let next = 0;
      for (const star of stars) {
        if (!clusterAngles.has(star.cluster)) {
          clusterAngles.set(star.cluster, (next++ / (clusterCounts.size || 1)) * Math.PI * 2);
        }
      }

      for (const star of stars) {
        const base = clusterAngles.get(star.cluster) ?? 0;
        const cAng = base + Math.sin(t * 0.05) * 0.2;
        const cR = R * 0.62;
        const bx = cx + Math.cos(cAng) * cR;
        const by = cy + Math.sin(cAng) * cR * 0.8;
        // link to cluster heart
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(star.x * w, star.y * h);
        ctx.strokeStyle = "rgba(233, 237, 232, 0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const star of stars) {
        const wobble = hash01(star.tw) * Math.PI * 2;
        const x = star.x * w + Math.sin(t * 0.7 + wobble) * 3;
        const y = star.y * h + Math.cos(t * 0.6 + wobble) * 3;
        const hover = hoverRef.current === star.tw;
        const alpha = 0.35 + star.sim * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, hover ? 4.4 : 2.4, 0, Math.PI * 2);
        ctx.fillStyle = hover
          ? "rgba(200, 255, 22, 1)"
          : `rgba(233, 237, 232, ${alpha})`;
        ctx.fill();
        if (hover) {
          ctx.fillStyle = "rgba(233, 237, 232, 0.92)";
          ctx.font = `${11 * dpr}px IBM Plex Mono, monospace`;
          ctx.fillText(star.fact.title.slice(0, 58).toUpperCase(), x + 10, y + 3);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = (event.clientX - rect.left) * dpr;
      const py = (event.clientY - rect.top) * dpr;
      let best = -1;
      let bestDist = 22 * dpr;
      starsRef.current.forEach((star, i) => {
        const dx = star.x * canvas.width - px;
        const dy = star.y * canvas.height - py;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      hoverRef.current = best;
      canvas.style.cursor = best >= 0 ? "pointer" : "default";
    };
    const onClick = () => {
      const idx = hoverRef.current;
      if (idx >= 0) setPicked(starsRef.current[idx]?.fact ?? null);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [status]);

  const build = async () => {
    setStatus("building");
    setError("");
    try {
      const index = (await buildMemoryIndex((event) => {
        if (event.status === "progress") setPct(event.pct);
      })) as MemoryIndex;
      if (!index.entries.length) {
        setError("MEMORY IS EMPTY — OPEN THE TERMINAL AND RUN /learn FIRST.");
        setStatus("error");
        return;
      }
      const clusters = kmeans(
        index.entries.map((entry) => entry.row),
        Math.min(6, Math.max(2, Math.floor(index.entries.length / 6))),
      );
      const clusterOf = new Map<number, number>();
      const simOf = new Map<number, number>();
      clusters.forEach((cluster) => {
        for (const member of cluster.members) {
          clusterOf.set(member, cluster.id);
          simOf.set(member, index.cosine(index.entries[member].row, cluster.center));
        }
      });
      starsRef.current = index.entries.map((entry, i) => {
        const cluster = clusterOf.get(i) ?? 0;
        const sim = simOf.get(i) ?? 0;
        const base = (cluster / clusters.length) * Math.PI * 2;
        const spread = 0.9 - sim;
        const ang = base + hash01(i) * spread * 2.4 + sim * 1.4;
        const rad = spread * 0.34 + hash01(i + 99) * 0.06;
        return {
          fact: entry.fact,
          x: 0.5 + Math.cos(ang) * rad * (0.9 + hash01(i + 7) * 0.2),
          y: 0.5 + Math.sin(ang) * rad * 0.78,
          cluster,
          sim,
          tw: i,
        };
      });
      setStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 140) : "grid build failed");
      setStatus("error");
    }
  };

  return (
    <div className="mesh-preview">
      {status === "cold" && (
        <button type="button" className="mesh-cta" onClick={() => void build()}>
          PROJECT THE GRID
        </button>
      )}
      {status === "building" && (
        <p className="mesh-build">
          EMBEDDING + CLUSTERING · <b>{pct}%</b>
        </p>
      )}
      {(status === "live" || status === "error") && (
        <canvas ref={canvasRef} className="mesh-starfield" />
      )}
      {status === "live" && (
        <p className="mesh-fine">
          {starsRef.current.length} FACTS · {new Set(starsRef.current.map((s) => s.cluster)).size}{" "}
          MEANING CLUSTERS · HOVER TO INSPECT, CLICK TO OPEN
        </p>
      )}
      {picked && (
        <a className="mesh-hit" href={picked.url} target="_blank" rel="noreferrer">
          <div className="mesh-hit__body">
            <span className="mesh-hit__meta">
              {picked.source} · {new Date(picked.at).toISOString().slice(0, 10)}
            </span>
            <strong>{picked.title}</strong>
            <p>{picked.text.slice(0, 240)}…</p>
          </div>
        </a>
      )}
      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
