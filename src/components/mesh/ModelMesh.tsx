import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { NODES, TIER_LABEL, type MeshNode } from "./registry";
import type { MeshNodeProps } from "./types";
import { WhisperEar } from "./nodes/WhisperEar";
import { MeshMemory } from "./nodes/MeshMemory";
import { SemanticGrid } from "./nodes/SemanticGrid";
import { GestureDeck } from "./nodes/GestureDeck";
import { MeshStatus } from "./nodes/MeshStatus";
import { PitNet } from "./nodes/PitNet";
import { CommandDeck } from "./nodes/CommandDeck";
import { Convoy } from "./nodes/Convoy";
import { DepthCam } from "./nodes/DepthCam";
import { VisionPit } from "./nodes/VisionPit";
import { PoseCoach } from "./nodes/PoseCoach";
import { DossierParser } from "./nodes/DossierParser";
import { BrowserBrain } from "./nodes/BrowserBrain";
import { Standby } from "./nodes/Standby";
import "./mesh.css";

const PREVIEWS: Record<string, ComponentType<MeshNodeProps>> = {
  whisper: WhisperEar,
  memory: MeshMemory,
  grid: SemanticGrid,
  gesture: GestureDeck,
  status: MeshStatus,
  pitnet: PitNet,
  command: CommandDeck,
  convoy: Convoy,
  brain: BrowserBrain,
  vision: VisionPit,
  pose: PoseCoach,
  depth: DepthCam,
  parser: DossierParser,
};

type Props = {
  scene: MeshNodeProps["scene"];
  onTune: MeshNodeProps["onTune"];
  onDrive: MeshNodeProps["onDrive"];
};

type Positioned = { node: MeshNode; x: number; y: number; scale: number; alpha: number };

const TIER_COLOR: Record<string, string> = {
  live: "200, 255, 22",
  link: "255, 90, 31",
  consent: "233, 237, 232",
};

type Pulse = { ring: number; from: number; to: number; t: number; speed: number };

export function ModelMesh({ scene, onTune, onDrive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MeshNode | null>(null);
  const [booted, setBooted] = useState(false);
  const pointerRef = useRef({ x: 0.5, y: 0.5, inside: false });
  const hitRef = useRef<Positioned[]>([]);
  const hoverRef = useRef(-1);
  const burstsRef = useRef<Pulse[]>([]);
  const selectedRef = useRef<MeshNode | null>(null);
  selectedRef.current = selected;

  const previewProps: MeshNodeProps = { scene, onTune, onDrive };

  const openNode = useCallback((node: MeshNode) => {
    setSelected(node);
    // Packet burst: the mesh lights the route to the node you opened.
    burstsRef.current.push(
      { ring: node.ring, from: -1, to: -1, t: 0, speed: 1.6 },
    );
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("locked");
    };
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let running = false;
    let t = Math.random() * 100;
    let last = performance.now();
    let bootT = 0;
    const pulses: Pulse[] = [];
    let pulseTimer = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.max(360, rect.width) * dpr;
      canvas.height = Math.max(300, rect.height) * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const ringSpec = (ring: number): { count: number; radius: number; tilt: number; w: number } => {
      const count = NODES.filter((n) => n.ring === ring).length;
      const radius = [0.3, 0.46, 0.62][ring] ?? 0.5;
      return { count, radius, tilt: [0.62, 0.5, 0.38][ring] ?? 0.5, w: [1, -0.7, 0.45][ring] ?? 1 };
    };

    const positions = (w: number, h: number): Positioned[] => {
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.86;
      const px = (pointerRef.current.x - 0.5) * (reduced ? 0 : 1);
      const py = (pointerRef.current.y - 0.5) * (reduced ? 0 : 1);
      const out: Positioned[] = [];
      NODES.forEach((node, index) => {
        const spec = ringSpec(node.ring);
        const sameRing = NODES.filter((n) => n.ring === node.ring);
        const indexInRing = sameRing.indexOf(node);
        const angle = (indexInRing / spec.count) * Math.PI * 2 + node.ring * 0.55 + t * spec.w * node.speed * 2.2;
        const ex = Math.cos(angle) * R * spec.radius;
        const ey = Math.sin(angle) * R * spec.radius * spec.tilt;
        const depth = Math.sin(angle) * 0.5 + 0.5;
        const intro = Math.min(1, Math.max(0, bootT * 1.4 - index * 0.055));
        out.push({
          node,
          x: cx + ex + px * (26 + node.ring * 16),
          y: cy + ey + py * (16 + node.ring * 10),
          scale: 0.72 + depth * 0.42,
          alpha: intro * (0.5 + depth * 0.5),
        });
      });
      return out;
    };

    const spawnPulse = (ring: number, from: number, to: number) => {
      pulses.push({ ring, from, to, t: 0, speed: 0.55 + Math.random() * 0.5 });
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduced) {
        t += dt;
        bootT = Math.min(2.2, bootT + dt * 0.9);
      }
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.86;
      ctx.clearRect(0, 0, w, h);

      const placed = positions(w, h);
      hitRef.current = placed;

      // ring orbits (faint)
      for (let ring = 0; ring < 3; ring++) {
        const spec = ringSpec(ring);
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * spec.radius, R * spec.radius * spec.tilt, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(233, 237, 232, 0.05)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // links core → node, neighbor links
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i];
        const aAlpha = a.alpha;
        if (aAlpha <= 0.01) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(a.x, a.y);
        ctx.strokeStyle = `rgba(${TIER_COLOR[a.node.tier]}, ${0.1 * aAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const sameRing = NODES.filter((n) => n.ring === a.node.ring);
        const nextIndex = (sameRing.indexOf(a.node) + 1) % sameRing.length;
        const b = placed.find((p) => p.node === sameRing[nextIndex]);
        if (b && b.alpha > 0.01) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(233, 237, 232, ${0.045 * Math.min(aAlpha, b.alpha)})`;
          ctx.stroke();
        }
      }

      // ambient pulses on random core→node links
      if (!reduced) {
        pulseTimer -= dt;
        if (pulseTimer <= 0 && bootT > 1) {
          pulseTimer = 0.5 + Math.random() * 0.7;
          const target = Math.floor(Math.random() * placed.length);
          spawnPulse(placed[target].node.ring, -1, target);
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const pulse = pulses[i];
          pulse.t += dt * pulse.speed;
          if (pulse.t >= 1) {
            pulses.splice(i, 1);
            continue;
          }
          const dest = placed[pulse.to];
          if (!dest) continue;
          const x = cx + (dest.x - cx) * pulse.t;
          const y = cy + (dest.y - cy) * pulse.t;
          const fade = Math.sin(pulse.t * Math.PI);
          ctx.beginPath();
          ctx.arc(x, y, 2.6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${TIER_COLOR[dest.node.tier]}, ${0.85 * fade})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${TIER_COLOR[dest.node.tier]}, ${0.14 * fade})`;
          ctx.fill();
        }
        // route burst to the opened node
        const sel = selectedRef.current;
        for (let i = burstsRef.current.length - 1; i >= 0; i--) {
          const burst = burstsRef.current[i];
          burst.t += dt * burst.speed;
          if (burst.t >= 1) {
            burstsRef.current.splice(i, 1);
            continue;
          }
          const dest = placed.find((p) => p.node === sel);
          if (!dest) continue;
          const x = cx + (dest.x - cx) * burst.t;
          const y = cy + (dest.y - cy) * burst.t;
          const fade = Math.sin(burst.t * Math.PI);
          ctx.beginPath();
          ctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200, 255, 22, ${0.95 * fade})`;
          ctx.shadowColor = "rgba(200, 255, 22, 0.8)";
          ctx.shadowBlur = 12 * dpr;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // core
      const corePulse = 0.5 + 0.5 * Math.sin(t * 1.8);
      ctx.beginPath();
      ctx.arc(cx, cy, 26 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(5, 6, 7, 0.9)";
      ctx.fill();
      ctx.strokeStyle = `rgba(200, 255, 22, ${0.75 - corePulse * 0.25})`;
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, (30 + corePulse * 16) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200, 255, 22, ${0.28 - corePulse * 0.2})`;
      ctx.stroke();
      // rotating tick ring
      if (!reduced) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.35);
        ctx.strokeStyle = "rgba(233, 237, 232, 0.22)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 34 * dpr, Math.sin(a) * 34 * dpr);
          ctx.lineTo(Math.cos(a) * (i % 6 === 0 ? 40 : 37) * dpr, Math.sin(a) * (i % 6 === 0 ? 40 : 37) * dpr);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.fillStyle = "rgba(200, 255, 22, 0.95)";
      ctx.font = `600 ${13 * dpr}px IBM Plex Mono, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("APEX", cx, cy - 2 * dpr);
      ctx.fillStyle = "rgba(233, 237, 232, 0.5)";
      ctx.font = `${8.5 * dpr}px IBM Plex Mono, monospace`;
      ctx.fillText("MESH CORE", cx, cy + 10 * dpr);
      ctx.textAlign = "left";

      // nodes
      placed.forEach((entry, i) => {
        const hovered = hoverRef.current === i;
        const color = TIER_COLOR[entry.node.tier];
        const size = (hovered ? 9.5 : 6.5) * dpr * entry.scale;
        ctx.save();
        ctx.translate(entry.x, entry.y);
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = entry.alpha;
        ctx.beginPath();
        ctx.rect(-size, -size, size * 2, size * 2);
        ctx.fillStyle = `rgba(5, 6, 7, 0.92)`;
        ctx.fill();
        ctx.strokeStyle = hovered ? "rgba(200, 255, 22, 0.95)" : `rgba(${color}, 0.8)`;
        ctx.lineWidth = 1.5 * dpr;
        if (hovered) {
          ctx.shadowColor = "rgba(200, 255, 22, 0.7)";
          ctx.shadowBlur = 10 * dpr;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (entry.node.tier === "live") {
          ctx.beginPath();
          ctx.rect(-size * 0.34, -size * 0.34, size * 0.68, size * 0.68);
          ctx.fillStyle = "rgba(200, 255, 22, 0.9)";
          ctx.fill();
        }
        ctx.restore();

        if (hovered) {
          const label = `${entry.node.code} ${entry.node.name}`;
          ctx.font = `600 ${11 * dpr}px IBM Plex Mono, monospace`;
          const tw = ctx.measureText(label).width;
          const bx = Math.min(w - tw - 26 * dpr, Math.max(6 * dpr, entry.x + 14 * dpr));
          const by = Math.max(6 * dpr, entry.y - 30 * dpr);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(5, 6, 7, 0.92)";
          ctx.fillRect(bx - 6 * dpr, by - 12 * dpr, tw + 16 * dpr, 22 * dpr);
          ctx.strokeStyle = `rgba(${color}, 0.6)`;
          ctx.strokeRect(bx - 6 * dpr, by - 12 * dpr, tw + 16 * dpr, 22 * dpr);
          ctx.fillStyle = "rgba(233, 237, 232, 0.95)";
          ctx.fillText(label, bx + 2 * dpr, by + 3 * dpr);
        }
        ctx.globalAlpha = 1;
      });

      if (running) raf = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!booted) setBooted(true);
            start();
          } else {
            stop();
          }
        }
      },
      { threshold: 0.12 },
    );
    io.observe(wrap);

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
        inside: true,
      };
      const px = (event.clientX - rect.left) * dpr;
      const py = (event.clientY - rect.top) * dpr;
      let best = -1;
      let bestDist = 26 * dpr;
      hitRef.current.forEach((entry, i) => {
        const dist = Math.hypot(entry.x - px, entry.y - py);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      hoverRef.current = best;
      canvas.style.cursor = best >= 0 ? "pointer" : "default";
      if (reduced && !running) draw(performance.now());
    };
    const onLeave = () => {
      pointerRef.current = { x: 0.5, y: 0.5, inside: false };
      hoverRef.current = -1;
    };
    const onClick = () => {
      const idx = hoverRef.current;
      if (idx >= 0) {
        const entry = hitRef.current[idx];
        if (entry) openNode(entry.node);
      }
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNode]);

  const liveCount = NODES.filter((n) => n.tier === "live").length;
  const linkCount = NODES.filter((n) => n.tier === "link").length;
  const consentCount = NODES.filter((n) => n.tier === "consent").length;

  return (
    <div className="mesh">
      <div className="mesh__stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="mesh__canvas" aria-label="Model mesh constellation of 20 AI nodes" />
        <div className="mesh__hud mesh__hud--tl">
          <span className="mesh__hud-title">MODEL MESH</span>
          <span className="mesh__hud-sub">20 NODES · ONE MIND · ALL LOCAL</span>
        </div>
        <div className="mesh__hud mesh__hud--tr">
          <span>
            <i className="mesh-dot mesh-dot--live" /> {liveCount} RUN NOW
          </span>
          <span>
            <i className="mesh-dot mesh-dot--link" /> {linkCount} SERVICE LINKS
          </span>
          <span>
            <i className="mesh-dot mesh-dot--consent" /> {consentCount} ON YOUR CALL
          </span>
        </div>
        <div className="mesh__hud mesh__hud--bl">
          <span>{booted ? "MESH BOOT SEQUENCE COMPLETE" : "BOOT SEQUENCE…"}</span>
        </div>
        <div className="mesh__hud mesh__hud--br">
          <span>CLICK A NODE TO OPEN ITS BAY ↗</span>
        </div>
      </div>

      <div className="mesh__index">
        {NODES.map((node) => (
          <button key={node.id} type="button" className="mesh-card" onClick={() => openNode(node)}>
            <span className="mesh-card__code">{node.code}</span>
            <span className={`mesh-card__name mesh-card__name--${node.tier}`}>{node.name}</span>
            <span className="mesh-card__tag">{node.tag}</span>
            <span className={`mesh-card__tier mesh-card__tier--${node.tier}`}>
              {node.tier === "live" ? "● LIVE" : node.tier === "link" ? "◌ LINK" : "◇ CONSENT"}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mesh-overlay" role="dialog" aria-modal="true" aria-label={selected.name}>
          <button type="button" className="mesh-overlay__backdrop" onClick={() => setSelected(null)} aria-label="Close node bay" />
          <div className="mesh-overlay__panel">
            <header className="mesh-overlay__head">
              <div>
                <span className="mesh-overlay__code">
                  {selected.code} · {TIER_LABEL[selected.tier]}
                </span>
                <h3>{selected.name}</h3>
                <span className="mesh-overlay__tag">{selected.tag}</span>
              </div>
              <div className="mesh-overlay__meta">
                <span>{selected.runtime}</span>
                <span>{selected.cost}</span>
                <button type="button" className="mesh-overlay__close" onClick={() => setSelected(null)}>
                  CLOSE ✕
                </button>
              </div>
            </header>
            <div className="mesh-overlay__body">
              <aside className="mesh-overlay__dossier">
                <p>{selected.blurb}</p>
                <div className="mesh-overlay__rows">
                  <div>
                    <span>RUNTIME</span>
                    <b>{selected.runtime}</b>
                  </div>
                  <div>
                    <span>WEIGHTS</span>
                    <b>{selected.cost}</b>
                  </div>
                  <div>
                    <span>NETWORK</span>
                    <b>NONE — LOOPBACK OR CACHE</b>
                  </div>
                </div>
              </aside>
              <main className="mesh-overlay__stage">
                {(() => {
                  const Preview = PREVIEWS[selected.id];
                  if (Preview) return <Preview {...previewProps} />;
                  return <Standby node={selected} />;
                })()}
              </main>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
