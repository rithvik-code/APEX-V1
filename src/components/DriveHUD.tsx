import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AssistCallout, DriveHudState, DriveTouch, DriveVehicle } from "../three/drive";
import type { DriveSetup } from "../lib/driveStore";
import { formatDelta, formatLap } from "../lib/driveStore";
import type { CircuitPoem } from "../lib/circuitPoetry";

export type TrackOutline = {
  points: Array<[number, number]>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  start: { x: number; z: number; heading: number };
  features: Array<{ kind: "ramp" | "hop" | "boost"; x: number; z: number }>;
};

type DriveHUDProps = {
  state: DriveHudState;
  lapPoem: CircuitPoem | null;
  liveryGlow: boolean;
  track: TrackOutline | null;
  audioOn: boolean;
  onAudio: () => void;
  onExit: () => void;
  onRestart: () => void;
  onRecover: () => void;
  onVehicle: (vehicle: DriveVehicle) => void;
  onSetup: (patch: Partial<DriveSetup>) => void;
  onGhost: (enabled: boolean) => void;
  onReplaySector: (time: number | null) => void;
  onAssist: (enabled: boolean) => void;
  onCallout: (callout: AssistCallout | null) => void;
  onTouch: (touch: DriveTouch) => void;
};

function Minimap({ state, track, sketch }: { state: DriveHudState; track: TrackOutline | null; sketch: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !track) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const pad = 18;
    const b = track.bounds;
    const spanX = b.maxX - b.minX || 1;
    const spanZ = b.maxZ - b.minZ || 1;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
    const ox = pad + ((W - pad * 2) - spanX * scale) / 2;
    const oy = pad + ((H - pad * 2) - spanZ * scale) / 2;
    const px = (x: number) => ox + (x - b.minX) * scale;
    const py = (z: number) => oy + (z - b.minZ) * scale;

    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    track.points.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(px(x), py(z));
      else ctx.lineTo(px(x), py(z));
    });
    ctx.closePath();
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(200,255,22,0.14)";
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(200,255,22,0.55)";
    ctx.stroke();

    if (sketch) {
      const redraw = Math.max(0.35, 2.2 - state.lapCount * 0.12);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(111,249,255,0.3)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      track.points.forEach(([x, z], i) => {
        const wobble = Math.sin(i * 1.71 + state.lapCount * 0.77) * redraw;
        const pointX = px(x) + wobble;
        const pointY = py(z) + Math.cos(i * 1.23 + state.lapCount * 0.61) * redraw;
        if (i === 0) ctx.moveTo(pointX, pointY);
        else ctx.lineTo(pointX, pointY);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    for (const feature of track.features) {
      const x = px(feature.x);
      const y = py(feature.z);
      ctx.fillStyle = feature.kind === "boost" ? "#6ff9ff" : "#ffb21f";
      ctx.beginPath();
      if (feature.kind === "boost") ctx.rect(x - 2.5, y - 2.5, 5, 5);
      else { ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.5, y + 3); ctx.lineTo(x - 3.5, y + 3); }
      ctx.closePath();
      ctx.fill();
    }

    // Start / finish tick.
    ctx.fillStyle = "#e9efe6";
    ctx.fillRect(px(track.start.x) - 5, py(track.start.z) - 2, 10, 4);

    // Ghost marker.
    if (state.ghostPos && state.ghostEnabled) {
      ctx.fillStyle = "rgba(200,255,22,0.4)";
      ctx.beginPath();
      ctx.arc(px(state.ghostPos.x), py(state.ghostPos.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player marker (triangle pointing along heading).
    ctx.save();
    ctx.translate(px(state.pos.x), py(state.pos.z));
    ctx.rotate(-state.heading);
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-5.5, -5);
    ctx.lineTo(0, -2.5);
    ctx.lineTo(5.5, -5);
    ctx.closePath();
    ctx.fillStyle = "#c8ff16";
    ctx.shadowColor = "rgba(200,255,22,0.8)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }, [state, track]);
  return <canvas ref={ref} className="dhud__minimap-canvas" width={240} height={240} />;
}

function SectorRow({
  index,
  value,
  best,
  active,
}: {
  index: number;
  value: number | null;
  best: number | null;
  active: boolean;
}) {
  const delta = value !== null && best !== null ? value - best : null;
  return (
    <div className={`dhud__sector${active ? " is-active" : ""}${value !== null ? " is-set" : ""}`}>
      <span>S{index + 1}</span>
      <b>{value !== null ? formatLap(value) : "--:--.---"}</b>
      <i className={delta === null ? "" : delta <= 0 ? "is-good" : "is-bad"}>
        {delta === null ? "—" : formatDelta(delta)}
      </i>
    </div>
  );
}

export function DriveHUD({
  state,
  lapPoem,
  liveryGlow,
  track,
  audioOn,
  onAudio,
  onExit,
  onRestart,
  onRecover,
  onVehicle,
  onSetup,
  onGhost,
  onReplaySector,
  onAssist,
  onCallout,
  onTouch,
}: DriveHUDProps) {
  const prevCallout = useRef<AssistCallout | null>(null);
  const [speedMotion, setSpeedMotion] = useState<"steady" | "snap-in" | "snap-out">("steady");
  const [sketchOn, setSketchOn] = useState(false);

  useEffect(() => {
    const next = state.assist.on ? state.assist.next : null;
    if (next && next !== prevCallout.current) {
      onCallout(next);
    } else if (!next) {
      onCallout(null);
    }
    prevCallout.current = next;
  }, [state.assist.on, state.assist.next, onCallout]);
  const countdownNumber = Math.max(0, Math.ceil(state.countdown));
  const showCountdown = state.phase === "countdown";
  const speed = Math.round(state.speedKmh);
  const lineOffset = useMemo(() => {
    if (!track?.points.length) return 0;
    let nearest = Infinity;
    for (const [x, z] of track.points) nearest = Math.min(nearest, Math.hypot(state.pos.x - x, state.pos.z - z));
    return nearest;
  }, [state.pos.x, state.pos.z, track]);
  const lineAlert = state.offTrack || lineOffset > 3.8;
  const previousSpeed = useRef(speed);
  useEffect(() => {
    const delta = speed - previousSpeed.current;
    previousSpeed.current = speed;
    if (Math.abs(delta) < 5) return;
    setSpeedMotion(delta < 0 ? "snap-in" : "snap-out");
    const timer = window.setTimeout(() => setSpeedMotion("steady"), 190);
    return () => window.clearTimeout(timer);
  }, [speed]);

  const hold = (flag: "throttle" | "brake" | "handbrake") => ({
    onPointerDown: (event: ReactPointerEvent) => {
      event.preventDefault();
      onTouch({ [flag]: true } as DriveTouch);
      try {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }
    },
    onPointerUp: () => onTouch({ [flag]: false } as DriveTouch),
    onPointerCancel: () => onTouch({ [flag]: false } as DriveTouch),
    onPointerLeave: () => onTouch({ [flag]: false } as DriveTouch),
  });

  const steerHold = (dir: -1 | 1) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      event.preventDefault();
      onTouch({ steer: dir });
      try {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }
    },
    onPointerUp: () => onTouch({ steer: 0 }),
    onPointerCancel: () => onTouch({ steer: 0 }),
    onPointerLeave: () => onTouch({ steer: 0 }),
  });

  return (
    <div className="drive-hud" role="region" aria-label="Time attack controls">
      <div className="dhud__timing">
        <div className="dhud__tag">
          <span className="dot" /> TIME ATTACK / {state.vehicle === "bike" ? "SUPERBIKE" : "SUPERCAR"}
          {liveryGlow && <span className="dhud__livery-glow" title="Livery edge glow follows rpm and boost">EDGE GLOW</span>}
          {state.wet && <em>WET</em>}
        </div>
        <div className="dhud__lap">
          <span>LAP {String(state.lapCount + 1).padStart(2, "0")}</span>
          <b>{formatLap(state.lapTime)}</b>
        </div>
        <div className="dhud__best-last">
          <div>
            <span>BEST</span>
            <b>{formatLap(state.bestTime)}</b>
          </div>
          <div>
            <span>LAST</span>
            <b>{formatLap(state.lastTime)}</b>
          </div>
        </div>
        <div className="dhud__sectors">
          {[0, 1, 2].map((i) => (
            <SectorRow
              key={i}
              index={i}
              value={state.sectors[i]}
              best={state.bestSectors[i]}
              active={state.sectorIndex === i}
            />
          ))}
        </div>
        {state.hasGhost && (
          <>
          <div className="dhud__replay-ribbons" aria-label="Checkpoint replay ribbons">
            {[0, 1, 2].map((i) => (
              <button key={i} type="button" className={`dhud__replay-ribbon is-sector-${i + 1}${state.ghostReplayTime === state.bestSectors[i] ? " is-selected" : ""}`} disabled={!state.hasGhost || state.bestSectors[i] === null} onClick={() => state.bestSectors[i] !== null && onReplaySector(state.bestSectors[i])} aria-label={state.bestSectors[i] === null ? `Sector ${i + 1}, no recorded checkpoint` : `Replay best lap at sector ${i + 1}, ${formatLap(state.bestSectors[i]!)}`}>
                <b>S{i + 1}</b><span>{state.bestSectors[i] === null ? "NO DATA" : formatLap(state.bestSectors[i]!)}</span>
              </button>
            ))}
            <button type="button" className="dhud__replay-live" disabled={state.ghostReplayTime === null} onClick={() => onReplaySector(null)}>LIVE RUN</button>
          </div>
          <p className="dhud__replay-caption" aria-live="polite">{state.ghostReplayTime === null ? "SELECT A RIBBON TO SCRUB YOUR BEST LAP GHOST TO THAT CHECKPOINT." : `BEST LAP GHOST · CHECKPOINT ${state.bestSectors.findIndex((time) => time === state.ghostReplayTime) + 1} · ${formatLap(state.ghostReplayTime)}`}</p>
          </>
        )}
        <div className="dhud__minimap">
          <Minimap state={state} track={track} sketch={sketchOn} />
        </div>
        <button type="button" className={`dhud__sketch-toggle${sketchOn ? " is-on" : ""}`} onClick={() => setSketchOn((value) => !value)} aria-pressed={sketchOn}>
          CIRCUIT SKETCH {sketchOn ? "ON" : "OFF"}<span>{Math.min(100, state.lapCount * 7)}% LEARNED</span>
        </button>
        <div className={`dhud__line-feedback${lineAlert ? " is-alert" : ""}`} role="status" aria-label={`Racing line ${lineAlert ? "off-line" : "centered"}; ${lineOffset.toFixed(1)} meters from center line`}>
          <i aria-hidden="true" style={{ transform: `scale(${lineAlert ? 1.2 + Math.min(1.2, lineOffset / 8) : 1})` }} />
          <span>{lineAlert ? "OFF LINE · RETURN" : "LINE CENTERED"}</span><b>{lineOffset.toFixed(1)} M</b>
        </div>
      </div>

      {state.assist.on && (
        <div className={`dhud__assist is-${state.assist.mode}`}>
          <div className="dhud__assist-top"><span>CIRCUIT CO-PILOT</span><b>{state.assist.mode.toUpperCase()}</b></div>
          <div className="dhud__assist-next">
            <i>{state.assist.next?.dir === "L" ? "↰" : state.assist.next?.dir === "R" ? "↱" : state.assist.next?.kind === "boost" ? "»" : "↗"}</i>
            <div><strong>{state.assist.next?.label ?? "CLEAR TRACK"}</strong><span>{state.assist.next?.active ? "NOW" : state.assist.next ? `${Math.round(state.assist.next.distM / 5) * 5} M AHEAD` : "FOLLOW THE LINE"}</span></div>
            <div className="dhud__assist-limit"><b>{Math.round(state.assist.next?.kmh ?? state.assist.targetKmh)}</b><span>KM/H SUGGESTED</span></div>
          </div>
          <div className="dhud__assist-key"><span>PUSH</span><span>LIFT</span><span>BRAKE</span></div>
        </div>
      )}

      <div className="dhud__board">
        <div className="dhud__board-head">
          <span>LEADERBOARD</span>
          <b>{state.board.length}/10</b>
        </div>
        <ol>
          {state.board.length === 0 && <li className="dhud__board-empty">NO LAPS LOGGED YET</li>}
          {state.board.slice(0, 6).map((entry, i) => (
            <li key={entry.id} className={state.lastRank === i + 1 ? "is-fresh" : ""}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{formatLap(entry.time)}</b>
              <i>{entry.vehicle === "bike" ? "BIKE" : "CAR"}</i>
            </li>
          ))}
        </ol>
      </div>

      <div className="dhud__setup">
        <div className="dhud__row">
          <span>VEHICLE</span>
          <div className="dhud__seg">
            <button
              type="button"
              className={state.vehicle === "car" ? "is-on" : ""}
              onClick={() => onVehicle("car")}
            >
              CAR
            </button>
            <button
              type="button"
              className={state.vehicle === "bike" ? "is-on" : ""}
              onClick={() => onVehicle("bike")}
            >
              BIKE
            </button>
          </div>
        </div>

        <label className="dhud__slider">
          <span>DOWNFORCE</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.setup.downforce}
            onChange={(event) => onSetup({ downforce: Number(event.target.value) })}
          />
          <b>{Math.round(state.setup.downforce * 100)}%</b>
        </label>

        <label className="dhud__slider">
          <span>POWER</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.setup.power}
            onChange={(event) => onSetup({ power: Number(event.target.value) })}
          />
          <b>{Math.round(state.setup.power * 100)}%</b>
        </label>

        <label className="dhud__slider dhud__body-language">
          <span>COCKPIT / BODY FEEL</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.setup.damping}
            aria-label="Body feel: sit back to lean in"
            aria-valuetext={state.setup.damping < 0.35 ? "Sit back, soft response" : state.setup.damping > 0.65 ? "Lean in, firm response" : "Balanced response"}
            onChange={(event) => onSetup({ damping: Number(event.target.value) })}
          />
          <b>{state.setup.damping < 0.35 ? "SIT BACK" : state.setup.damping > 0.65 ? "LEAN IN" : "BALANCED"}</b>
        </label>

        <div className="dhud__row">
          <span>TIRES</span>
          <div className="dhud__seg dhud__seg--three">
            {(["soft", "medium", "hard"] as const).map((compound) => (
              <button
                key={compound}
                type="button"
                className={state.setup.tires === compound ? "is-on" : ""}
                onClick={() => onSetup({ tires: compound })}
              >
                {compound === "soft" ? "S" : compound === "medium" ? "M" : "H"}
              </button>
            ))}
          </div>
        </div>

        <div className="dhud__tire-life" role="img" aria-label={`Tire wear ${Math.round(state.tireWear * 100)} percent; outer shoulder wear ${Math.round(state.shoulderWear * 100)} percent`}>
          <span>TYRE CONDITION</span>
          <div className="dhud__tire-visual" aria-hidden="true">{[0, 1, 2, 3].map((tire) => <i key={tire} className={`is-wheel-${tire}`}><b /><em style={{ opacity: Math.max(0.12, state.tireWear), transform: `scaleX(${Math.max(0.12, state.shoulderWear)})` }} /></i>)}</div>
          <div className="dhud__tire-life-track"><i style={{ width: `${Math.round(state.tireWear * 100)}%` }} /><b style={{ width: `${Math.round(state.shoulderWear * 100)}%` }} /></div>
          <small>{Math.round(state.tireWear * 100)}% USED <em>·</em> SHOULDER {Math.round(state.shoulderWear * 100)}%</small>
        </div>

        <div className="dhud__ghost">
          <button
            type="button"
            className={`dhud__toggle${state.assist.on ? " is-on" : ""}`}
            onClick={() => onAssist(!state.assist.on)}
            aria-pressed={state.assist.on}
          >
            LINE {state.assist.on ? "ON" : "OFF"}<em>L</em>
          </button>
          <button
            type="button"
            className={`dhud__toggle${state.ghostEnabled ? " is-on" : ""}`}
            onClick={() => onGhost(!state.ghostEnabled)}
            aria-pressed={state.ghostEnabled}
          >
            GHOST {state.ghostEnabled ? "ON" : "OFF"}
            {!state.hasGhost && <em>NO BEST LAP</em>}
          </button>
        </div>
      </div>

      <div className="dhud__speed">
        <div className="dhud__gear">
          <span>GEAR</span>
          <b>{state.gear}</b>
        </div>
        <div className={`dhud__speed-num is-${speedMotion}${state.brake > 0.2 ? " is-braking" : ""}`}>
          <b>{speed}</b>
          <span>KM/H</span>
        </div>
        <div className={`dhud__air${state.airborne ? " is-on" : ""}`}><span>{state.airborne ? "AIR TIME" : "BEST AIR"}</span><b>{(state.airborne ? state.airTime : state.bestAir).toFixed(2)} S</b></div>
        <div className={`dhud__boost${state.boost > 0 ? " is-on" : ""}`}><span>BOOST</span><div><i style={{ width: `${state.boost * 100}%` }} /></div></div>
        <div className="dhud__tach">
          <i style={{ width: `${Math.round(state.rpmNorm * 100)}%` }} />
        </div>
        <div className={`dhud__drift${state.drift > 0.25 ? " is-on" : ""}`}>
          <span style={{ width: `${Math.round(state.drift * 100)}%` }} />
        </div>
      </div>

      <div className="dhud__controls">
        <button type="button" className="dhud__btn" onClick={onRestart}>
          RESTART <kbd>R</kbd>
        </button>
        <button type="button" className="dhud__btn" onClick={onRecover}>
          RECOVER <kbd>C</kbd>
        </button>
        <button
          type="button"
          className={`dhud__btn dhud__btn--audio${audioOn ? " is-on" : ""}`}
          onClick={onAudio}
        >
          AUDIO {audioOn ? "ON" : "OFF"}
        </button>
        <button type="button" className="dhud__btn dhud__btn--exit" onClick={onExit}>
          EXIT <kbd>ESC</kbd>
        </button>
        <span className="dhud__hint">WASD / ARROWS · SPACE DRIFT · L LINE</span>
      </div>

      <div className="dhud__touch" aria-hidden="true">
        <div className="dhud__touch-steer">
          <button type="button" {...steerHold(-1)}>◀</button>
          <button type="button" {...steerHold(1)}>▶</button>
        </div>
        <div className="dhud__touch-pedals">
          <button type="button" className="is-brake" {...hold("brake")}>BRAKE</button>
          <button type="button" className="is-handbrake" {...hold("handbrake")}>DRIFT</button>
          <button type="button" className="is-throttle" {...hold("throttle")}>GAS</button>
        </div>
      </div>

      {showCountdown && (
        <div className="dhud__countdown" aria-live="polite">
          {countdownNumber > 0 ? countdownNumber : "GO"}
        </div>
      )}

      {state.flash && !showCountdown && (
        <div className={`dhud__flash dhud__flash--${state.flash.kind}`}>
          {state.flash.text}
        </div>
      )}

      {lapPoem && (
        <section className="dhud__poem" role="status" aria-label="Cyrus circuit poem for your new personal best">
          <span>CYRUS // CIRCUIT POEM</span>
          <div>{lapPoem.lines.map((line) => <p key={line}>{line}</p>)}</div>
          <footer><b>{lapPoem.vehicle.toUpperCase()} · {formatLap(lapPoem.time)}</b><span>{lapPoem.sectors.map(formatLap).join(" / ")}</span></footer>
        </section>
      )}

      {state.offTrack && <div className="dhud__offtrack">OFF TRACK</div>}
    </div>
  );
}
