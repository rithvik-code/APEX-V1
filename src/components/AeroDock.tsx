import { useEffect, useRef, useState } from "react";
import {
  aeroTelemetry,
  CAMERA_PRESETS,
  decodeSetup,
  dynoPeak,
  dynoPoint,
  dynoSweep,
  encodeSetup,
  LIGHTING_PRESETS,
  LIVERIES,
  loadGarage,
  removeFromGarage,
  rpmValue,
  saveToGarage,
  setupShareUrl,
  type GarageEntry,
  type SceneConfig,
  type Weather,
} from "../lib/scene";
import {
  downloadBlob,
  loadLaps,
  removeLap,
  saveLap,
  type LapRecording,
} from "../lib/clip";
import { sound } from "../lib/sound";

export type DockBridge = {
  startClip: () => void;
  stopClip: () => void;
  startLap: () => void;
  stopLap: () => LapRecording | null;
  playLap: (lap: LapRecording) => void;
  pauseLap: () => void;
  resumeLap: () => void;
  seekLap: (time: number) => void;
  stopReplay: () => void;
};

export type DockStatus = {
  isClipping: boolean;
  isRecordingLap: boolean;
  lapElapsed: number;
  isReplaying: boolean;
  replayPaused: boolean;
  replayTime: number;
  replayDuration: number;
};

type Tab = "flow" | "style" | "dyno" | "garage" | "replay";

const TABS: Array<{ id: Tab; name: string }> = [
  { id: "flow", name: "FLOW" },
  { id: "style", name: "STYLE" },
  { id: "dyno", name: "DYNO" },
  { id: "garage", name: "GARAGE" },
  { id: "replay", name: "REPLAY" },
];

export function AeroLaunch({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const onMove = (event: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    el.style.setProperty("--mx", `${dx * 0.14}px`);
    el.style.setProperty("--my", `${dy * 0.14}px`);
  };

  const onLeave = () => {
    ref.current?.style.setProperty("--mx", "0px");
    ref.current?.style.setProperty("--my", "0px");
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`aero-launch${active ? " is-live" : ""}`}
      onClick={onToggle}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      aria-pressed={active}
      aria-label={active ? "Close wind tunnel" : "Open wind tunnel aero flow"}
    >
      <span className="aero-launch__shock" aria-hidden="true" />
      <span className="aero-launch__ring" aria-hidden="true" />
      <span className="aero-launch__comets" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i
            key={i}
            style={{
              ["--a" as string]: `${i * 60}deg`,
              ["--d" as string]: `${i * 0.45}s`,
            }}
          />
        ))}
      </span>
      <span className="aero-launch__core">
        <span className="aero-launch__label">{active ? "LIVE" : "AERO"}</span>
        <span className="aero-launch__sub">
          {active ? "TUNNEL ON" : "WIND TUNNEL"}
        </span>
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`aero-ctl${disabled ? " is-disabled" : ""}`}>
      <span className="aero-ctl__head">
        <span>{label}</span>
        <b>
          {value}
          <i>{unit}</i>
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          ["--fill" as string]: `${((value - min) / (max - min)) * 100}%`,
        }}
      />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; name: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="aero-ctl">
      <span className="aero-ctl__head">
        <span>{label}</span>
      </span>
      <div className="aero-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={value === option.id ? "is-on" : ""}
            onClick={() => {
              sound.tick("click");
              onChange(option.id);
            }}
            aria-pressed={value === option.id}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`aero-toggle${on ? " is-on" : ""}`}
      onClick={() => {
        sound.tick("click");
        onChange(!on);
      }}
      aria-pressed={on}
    >
      <span className="aero-toggle__track">
        <i />
      </span>
      {label}
    </button>
  );
}

function DynoChart({ norm }: { norm: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const sweep = dynoSweep(60);
    const maxT = 700;
    const maxP = 1100;
    const padL = 6;
    const padR = 6;
    const padT = 8;
    const padB = 16;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.strokeStyle = "rgba(233,237,232,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const drawCurve = (
      key: "torqueNm" | "powerHp",
      max: number,
      color: string,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      sweep.forEach((point, index) => {
        const x = padL + (index / (sweep.length - 1)) * plotW;
        const y = padT + plotH - (point[key] / max) * plotH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    drawCurve("torqueNm", maxT, "#c8ff16");
    drawCurve("powerHp", maxP, "#e9ede8");

    const markerX = padL + norm * plotW;
    ctx.strokeStyle = "rgba(200,255,22,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(markerX, padT);
    ctx.lineTo(markerX, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const point = dynoPoint(norm);
    const tY = padT + plotH - (point.torqueNm / maxT) * plotH;
    const pY = padT + plotH - (point.powerHp / maxP) * plotH;
    ctx.fillStyle = "#c8ff16";
    ctx.beginPath();
    ctx.arc(markerX, tY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9ede8";
    ctx.beginPath();
    ctx.arc(markerX, pY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#6c7871";
    ctx.textBaseline = "bottom";
    ctx.fillText("1K", padL, h - 3);
    ctx.textAlign = "right";
    ctx.fillText("12K RPM", w - padR, h - 3);
    ctx.textAlign = "left";
  }, [norm]);

  return (
    <div className="aero-dyno">
      <canvas ref={ref} width={290} height={150} aria-hidden="true" />
      <div className="aero-dyno__legend">
        <span><i style={{ background: "#c8ff16" }} /> TORQUE Nm</span>
        <span><i style={{ background: "#e9ede8" }} /> POWER HP</span>
      </div>
    </div>
  );
}

function exportDynoSheet(): void {
  const rows = ["rpm,torque_nm,power_hp"];
  for (const point of dynoSweep(60)) {
    rows.push(`${point.rpm},${point.torqueNm.toFixed(1)},${point.powerHp.toFixed(1)}`);
  }
  const peak = dynoPeak();
  rows.push("");
  rows.push(`peak_torque_nm,${peak.torqueNm.toFixed(1)}`);
  rows.push(`peak_torque_rpm,${peak.torqueRpm}`);
  rows.push(`peak_power_hp,${peak.powerHp.toFixed(1)}`);
  rows.push(`peak_power_rpm,${peak.powerRpm}`);
  downloadBlob(
    new Blob([rows.join("\n")], { type: "text/csv" }),
    "apex-dyno-sheet.csv",
  );
}

export function AeroDock({
  config,
  onChange,
  onClose,
  onExport,
  onRandomize,
  onReset,
  bridge,
  status,
}: {
  config: SceneConfig;
  onChange: (patch: Partial<SceneConfig>) => void;
  onClose: () => void;
  onExport: () => void;
  onRandomize: () => void;
  onReset: () => void;
  bridge: DockBridge;
  status: DockStatus;
}) {
  const [tab, setTab] = useState<Tab>("flow");
  const [garage, setGarage] = useState<GarageEntry[]>(() => loadGarage());
  const [laps, setLaps] = useState<LapRecording[]>(() => loadLaps());
  const [playingLap, setPlayingLap] = useState<LapRecording | null>(null);
  const [buildName, setBuildName] = useState("");
  const [importCode, setImportCode] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const telemetry = aeroTelemetry(config.windSpeed);
  const livery =
    LIVERIES.find((entry) => entry.id === config.livery) ?? LIVERIES[0];
  const dyno = dynoPoint(config.rpm);
  const peak = dynoPeak();
  const activeLap = status.isReplaying ? playingLap : null;

  const flashShare = (msg: string) => {
    setShareMsg(msg);
    window.setTimeout(() => setShareMsg(""), 2200);
  };

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flashShare(msg);
    } catch {
      flashShare("CLIPBOARD BLOCKED — CODE BELOW");
      setImportCode(text);
    }
    sound.tick("click");
  };

  const handleStopLap = () => {
    const lap = bridge.stopLap();
    if (lap) {
      saveLap(lap);
      setLaps(loadLaps());
      sound.tick("start");
    }
  };

  const handleSaveBuild = () => {
    saveToGarage(buildName, config);
    setGarage(loadGarage());
    setBuildName("");
    sound.tick("start");
  };

  const handleImport = () => {
    const patch = decodeSetup(importCode);
    if (!patch) {
      flashShare("INVALID SETUP CODE");
      return;
    }
    onChange(patch);
    setImportCode("");
    flashShare("SETUP LOADED");
    sound.tick("start");
  };

  return (
    <aside className="aero-dock" aria-label="Wind tunnel controls">
      <header className="aero-dock__head">
        <div>
          <span className="aero-dock__tag">APEX CONFIGURATOR</span>
          <b>
            <i /> {status.isClipping ? "RECORDING" : status.isRecordingLap ? "LAP REC" : "LIVE"}
          </b>
        </div>
        <button
          type="button"
          className="aero-dock__close"
          onClick={onClose}
          aria-label="Close wind tunnel"
        >
          ×
        </button>
      </header>

      <nav className="aero-dock__tabs" aria-label="Configurator sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "is-on" : ""}
            onClick={() => {
              sound.tick("hover");
              setTab(entry.id);
            }}
            aria-pressed={tab === entry.id}
          >
            {entry.name}
          </button>
        ))}
      </nav>

      <div className="aero-dock__scroll">
        {tab === "flow" && (
          <>
            <div className="aero-telemetry">
              <div>
                <span>SPEED</span>
                <b>{config.windSpeed}<i>KM/H</i></b>
                <em style={{ width: `${(config.windSpeed / 400) * 100}%` }} />
              </div>
              <div>
                <span>DOWNFORCE</span>
                <b>{Math.round(telemetry.downforceKg).toLocaleString()}<i>KG</i></b>
                <em style={{ width: `${Math.min(100, (telemetry.downforceKg / 2000) * 100)}%` }} />
              </div>
              <div>
                <span>DRAG</span>
                <b>{Math.round(telemetry.dragN).toLocaleString()}<i>N</i></b>
                <em style={{ width: `${Math.min(100, (telemetry.dragN / 7000) * 100)}%` }} />
              </div>
              <div>
                <span>L / D</span>
                <b>{telemetry.efficiency.toFixed(2)}<i>EFF</i></b>
                <em style={{ width: `${(telemetry.efficiency / 4) * 100}%` }} />
              </div>
            </div>

            <div className="aero-dock__group">
              <Slider label="WIND SPEED" value={config.windSpeed} min={40} max={400} step={5} unit=" KM/H" onChange={(windSpeed) => onChange({ windSpeed })} />
              <Slider label="PARTICLE DENSITY" value={Math.round(config.density * 100)} min={10} max={100} step={5} unit="%" onChange={(v) => onChange({ density: v / 100 })} />
              <Slider label="WAKE TURBULENCE" value={Math.round(config.turbulence * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => onChange({ turbulence: v / 100 })} />
              <Slider label="TIME DILATION" value={Math.round(config.timeScale * 100)} min={10} max={200} step={5} unit="%" onChange={(v) => onChange({ timeScale: v / 100 })} />
              <Slider label="BLOOM / GLOW" value={Math.round(config.glow * 100)} min={0} max={150} step={5} unit="%" onChange={(v) => onChange({ glow: v / 100 })} />
            </div>

            <div className="aero-dock__group">
              <Segmented label="FLOW COLOR" value={config.colorMode} options={[{ id: "velocity" as const, name: "VELOCITY" }, { id: "pressure" as const, name: "PRESSURE" }, { id: "acid" as const, name: "ACID" }]} onChange={(colorMode) => onChange({ colorMode })} />
              <Segmented label="FLOW FOCUS" value={config.focus} options={[{ id: "both" as const, name: "BOTH" }, { id: "car" as const, name: "CAR" }, { id: "bike" as const, name: "BIKE" }]} onChange={(focus) => onChange({ focus })} />
              <Segmented label="CAMERA" value={config.camera} options={CAMERA_PRESETS} onChange={(camera) => onChange({ camera })} />
              <Segmented label="LIGHTING" value={config.lighting} options={LIGHTING_PRESETS} onChange={(lighting) => onChange({ lighting })} />
            </div>

            <div className="aero-dock__group">
              <Segmented<Weather> label="WEATHER" value={config.weather} options={[{ id: "clear", name: "CLEAR" }, { id: "rain", name: "RAIN" }]} onChange={(weather) => onChange({ weather })} />
              <Slider label="RAIN INTENSITY" value={Math.round(config.rainAmount * 100)} min={10} max={100} step={5} unit="%" disabled={config.weather !== "rain"} onChange={(v) => onChange({ rainAmount: v / 100 })} />
              <div className="aero-toggles">
                <Toggle label="NIGHT RACE" on={config.nightRace} onChange={(nightRace) => onChange({ nightRace })} />
                <Toggle label="AUTO-ORBIT" on={config.autoOrbit} onChange={(autoOrbit) => onChange({ autoOrbit })} />
              </div>
              <div className="aero-toggles">
                <Toggle label="GRID FLOOR" on={config.grid} onChange={(grid) => onChange({ grid })} />
              </div>
            </div>
          </>
        )}

        {tab === "style" && (
          <>
            <div className="aero-dock__group">
              <div className="aero-ctl">
                <span className="aero-ctl__head">
                  <span>PRESET LIVERY</span>
                  <b>{config.paint.enabled ? "CUSTOM" : livery.name}</b>
                </span>
                <div className="aero-swatches" role="group" aria-label="Livery">
                  {LIVERIES.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={!config.paint.enabled && config.livery === entry.id ? "is-on" : ""}
                      style={{ ["--swatch" as string]: entry.css }}
                      onClick={() => {
                        sound.tick("click");
                        onChange({ livery: entry.id, paint: { ...config.paint, enabled: false } });
                      }}
                      aria-label={`Livery ${entry.name}`}
                      aria-pressed={!config.paint.enabled && config.livery === entry.id}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>LIVERY PAINTER</span></div>
              <div className="aero-toggles">
                <Toggle label="CUSTOM PAINT" on={config.paint.enabled} onChange={(enabled) => onChange({ paint: { ...config.paint, enabled } })} />
                <Toggle label="HOOD STRIPE" on={config.paint.stripe} onChange={(stripe) => onChange({ paint: { ...config.paint, stripe, enabled: true } })} />
              </div>
              <div className={`aero-paint${config.paint.enabled ? "" : " is-disabled"}`}>
                <label className="aero-paint__color">
                  <span>BASE</span>
                  <input type="color" value={config.paint.base} disabled={!config.paint.enabled} onChange={(e) => onChange({ paint: { ...config.paint, base: e.target.value, enabled: true } })} />
                </label>
                <label className="aero-paint__color">
                  <span>ACCENT</span>
                  <input type="color" value={config.paint.accent} disabled={!config.paint.enabled} onChange={(e) => onChange({ paint: { ...config.paint, accent: e.target.value, enabled: true } })} />
                </label>
                <label className="aero-paint__number">
                  <span>NUMBER</span>
                  <input type="text" maxLength={3} value={config.paint.number} disabled={!config.paint.enabled} onChange={(e) => onChange({ paint: { ...config.paint, number: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3), enabled: true } })} />
                </label>
              </div>
            </div>

            <div className="aero-dock__group">
              <Slider label="EXPLODED VIEW" value={Math.round(config.explode * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => onChange({ explode: v / 100 })} />
              <p className="aero-dock__note">Pull the assemblies apart to inspect the monocoque, canopy, aero and V12. Labels track each part in 3D.</p>
            </div>
          </>
        )}

        {tab === "dyno" && (
          <>
            <div className="aero-telemetry">
              <div>
                <span>ENGINE</span>
                <b>{rpmValue(config.rpm).toLocaleString()}<i>RPM</i></b>
                <em style={{ width: `${config.rpm * 100}%` }} />
              </div>
              <div>
                <span>TORQUE</span>
                <b>{Math.round(dyno.torqueNm)}<i>Nm</i></b>
                <em style={{ width: `${(dyno.torqueNm / 700) * 100}%` }} />
              </div>
              <div>
                <span>POWER</span>
                <b>{Math.round(dyno.powerHp)}<i>HP</i></b>
                <em style={{ width: `${Math.min(100, (dyno.powerHp / 1100) * 100)}%` }} />
              </div>
              <div>
                <span>PEAK</span>
                <b>{Math.round(peak.powerHp)}<i>HP</i></b>
                <em style={{ width: "100%" }} />
              </div>
            </div>
            <div className="aero-dock__group">
              <div className="aero-toggles">
                <Toggle label="RUN DYNO" on={config.dyno} onChange={(dynoOn) => onChange({ dyno: dynoOn })} />
              </div>
              <Slider label="THROTTLE / RPM" value={Math.round(config.rpm * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => onChange({ rpm: v / 100, dyno: true })} />
              <DynoChart norm={config.rpm} />
              <p className="aero-dock__note">6.5L V12 BITURBO · {Math.round(peak.torqueNm)} Nm @ {peak.torqueRpm.toLocaleString()} · {Math.round(peak.powerHp)} HP @ {peak.powerRpm.toLocaleString()}</p>
            </div>
            <div className="aero-dock__actions aero-dock__actions--single">
              <button type="button" className="aero-dock__export" onClick={() => { exportDynoSheet(); sound.tick("start"); }}>
                EXPORT DYNO SHEET ↓
              </button>
            </div>
          </>
        )}

        {tab === "garage" && (
          <>
            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>SAVE CURRENT BUILD</span></div>
              <div className="aero-row">
                <input className="aero-input" type="text" maxLength={28} placeholder="BUILD NAME" value={buildName} onChange={(e) => setBuildName(e.target.value)} />
                <button type="button" className="aero-btn" onClick={handleSaveBuild}>SAVE</button>
              </div>
            </div>

            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>SETUP SHARE CODE</span></div>
              <div className="aero-row">
                <button type="button" className="aero-btn" onClick={() => void copyText(encodeSetup(config), "CODE COPIED")}>COPY CODE</button>
                <button type="button" className="aero-btn" onClick={() => void copyText(setupShareUrl(config), "LINK COPIED")}>COPY LINK</button>
              </div>
              <textarea className="aero-input aero-input--area" rows={2} placeholder="PASTE A FRIEND'S CODE TO IMPORT" value={importCode} onChange={(e) => setImportCode(e.target.value)} />
              <div className="aero-row">
                <button type="button" className="aero-btn aero-btn--acid" onClick={handleImport}>LOAD CODE</button>
              </div>
              {shareMsg && <p className="aero-dock__flash">{shareMsg}</p>}
            </div>

            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>GARAGE</span><b>{garage.length}/24</b></div>
              {garage.length === 0 && <p className="aero-dock__note">No saved machines yet. Tune a build and save it here.</p>}
              <ul className="aero-list">
                {garage.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" className="aero-list__load" onClick={() => { onChange(entry.config); sound.tick("start"); }}>
                      <b>{entry.name}</b>
                      <span>{new Date(entry.createdAt).toLocaleDateString()} · {entry.config.windSpeed} KM/H</span>
                    </button>
                    <button type="button" className="aero-list__del" aria-label={`Delete ${entry.name}`} onClick={() => { setGarage(removeFromGarage(entry.id)); sound.tick("click"); }}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {tab === "replay" && (
          <>
            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>GHOST LAP</span><b>{status.isRecordingLap ? `${status.lapElapsed.toFixed(1)}s` : "READY"}</b></div>
              <div className="aero-row">
                {status.isRecordingLap ? (
                  <button type="button" className="aero-btn aero-btn--acid" onClick={handleStopLap}>■ STOP & SAVE LAP</button>
                ) : (
                  <button type="button" className="aero-btn" onClick={() => { bridge.startLap(); sound.tick("start"); }}>● RECORD LAP</button>
                )}
              </div>
              <p className="aero-dock__note">Record a camera flight — scroll and orbit to drive. Replay it as a ghost path and scrub the timeline.</p>
            </div>

            {status.isReplaying && (
              <div className="aero-dock__group">
                <div className="aero-ctl__head"><span>REPLAY</span><b>{status.replayTime.toFixed(1)} / {status.replayDuration.toFixed(1)}s</b></div>
                <input className="aero-scrub" type="range" min={0} max={Math.max(0.1, status.replayDuration)} step={0.05} value={status.replayTime} onChange={(e) => bridge.seekLap(Number(e.target.value))} style={{ ["--fill" as string]: `${(status.replayTime / Math.max(0.1, status.replayDuration)) * 100}%` }} />
                <div className="aero-row">
                  <button type="button" className="aero-btn" onClick={() => { if (status.replayPaused) bridge.resumeLap(); else bridge.pauseLap(); }}>{status.replayPaused ? "▶ PLAY" : "❚❚ PAUSE"}</button>
                  <button type="button" className="aero-btn" onClick={() => { bridge.stopReplay(); setPlayingLap(null); }}>■ EXIT</button>
                </div>
                {activeLap && (
                  <div className="aero-compare">
                    <span>LAP SETUP vs CURRENT</span>
                    <div><i>DOWNFORCE</i><b>{Math.round(aeroTelemetry(activeLap.config.windSpeed).downforceKg)} / {Math.round(telemetry.downforceKg)} KG</b></div>
                    <div><i>POWER</i><b>{Math.round(dynoPoint(activeLap.config.rpm).powerHp)} / {Math.round(dyno.powerHp)} HP</b></div>
                  </div>
                )}
              </div>
            )}

            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>SAVED LAPS</span><b>{laps.length}/8</b></div>
              {laps.length === 0 && <p className="aero-dock__note">No laps recorded yet.</p>}
              <ul className="aero-list">
                {laps.map((lap) => (
                  <li key={lap.id}>
                    <button type="button" className="aero-list__load" onClick={() => { setPlayingLap(lap); bridge.playLap(lap); sound.tick("start"); }}>
                      <b>{lap.name}</b>
                      <span>{lap.duration.toFixed(1)}s · {lap.samples.length} frames</span>
                    </button>
                    <button type="button" className="aero-list__del" aria-label={`Delete ${lap.name}`} onClick={() => { setLaps(removeLap(lap.id)); sound.tick("click"); }}>×</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="aero-dock__group">
              <div className="aero-ctl__head"><span>CINEMATIC CLIP</span><b>{status.isClipping ? "● REC" : "WEBM"}</b></div>
              <div className="aero-row">
                {status.isClipping ? (
                  <button type="button" className="aero-btn aero-btn--acid" onClick={() => { bridge.stopClip(); sound.tick("start"); }}>■ STOP & SAVE WEBM</button>
                ) : (
                  <button type="button" className="aero-btn" onClick={() => { bridge.startClip(); sound.tick("start"); }}>● RECORD VIEWPORT</button>
                )}
              </div>
              <p className="aero-dock__note">Captures the live viewport with burned-in telemetry to a shareable WebM.</p>
            </div>
          </>
        )}

        <div className="aero-dock__actions">
          <button type="button" onClick={onRandomize}>RANDOMIZE</button>
          <button type="button" onClick={onReset}>RESET</button>
          <button type="button" className="aero-dock__export" onClick={onExport}>EXPORT PNG ↓</button>
        </div>

        <p className="aero-dock__keys">
          A — TUNNEL · C — CAMERA · L — LIVERY · G — GRID · E — EXPORT
        </p>
      </div>
    </aside>
  );
}