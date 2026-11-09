import { useRef } from "react";
import {
  aeroTelemetry,
  CAMERA_PRESETS,
  LIGHTING_PRESETS,
  LIVERIES,
  type SceneConfig,
} from "../lib/scene";
import { sound } from "../lib/sound";

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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="aero-ctl">
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

export function AeroDock({
  config,
  onChange,
  onClose,
  onExport,
  onRandomize,
  onReset,
}: {
  config: SceneConfig;
  onChange: (patch: Partial<SceneConfig>) => void;
  onClose: () => void;
  onExport: () => void;
  onRandomize: () => void;
  onReset: () => void;
}) {
  const telemetry = aeroTelemetry(config.windSpeed);
  const livery =
    LIVERIES.find((entry) => entry.id === config.livery) ?? LIVERIES[0];

  return (
    <aside className="aero-dock" aria-label="Wind tunnel controls">
      <header className="aero-dock__head">
        <div>
          <span className="aero-dock__tag">WIND TUNNEL</span>
          <b>
            <i /> LIVE FLOW
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

      <div className="aero-dock__scroll">
        <div className="aero-telemetry">
          <div>
            <span>SPEED</span>
            <b>
              {config.windSpeed}
              <i>KM/H</i>
            </b>
            <em style={{ width: `${(config.windSpeed / 400) * 100}%` }} />
          </div>
          <div>
            <span>DOWNFORCE</span>
            <b>
              {Math.round(telemetry.downforceKg).toLocaleString()}
              <i>KG</i>
            </b>
            <em
              style={{
                width: `${Math.min(100, (telemetry.downforceKg / 2000) * 100)}%`,
              }}
            />
          </div>
          <div>
            <span>DRAG</span>
            <b>
              {Math.round(telemetry.dragN).toLocaleString()}
              <i>N</i>
            </b>
            <em
              style={{
                width: `${Math.min(100, (telemetry.dragN / 7000) * 100)}%`,
              }}
            />
          </div>
          <div>
            <span>L / D</span>
            <b>
              {telemetry.efficiency.toFixed(2)}
              <i>EFF</i>
            </b>
            <em style={{ width: `${(telemetry.efficiency / 4) * 100}%` }} />
          </div>
        </div>

        <div className="aero-dock__group">
          <Slider
            label="WIND SPEED"
            value={config.windSpeed}
            min={40}
            max={400}
            step={5}
            unit=" KM/H"
            onChange={(windSpeed) => onChange({ windSpeed })}
          />
          <Slider
            label="PARTICLE DENSITY"
            value={Math.round(config.density * 100)}
            min={10}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => onChange({ density: v / 100 })}
          />
          <Slider
            label="WAKE TURBULENCE"
            value={Math.round(config.turbulence * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => onChange({ turbulence: v / 100 })}
          />
          <Slider
            label="TIME DILATION"
            value={Math.round(config.timeScale * 100)}
            min={10}
            max={200}
            step={5}
            unit="%"
            onChange={(v) => onChange({ timeScale: v / 100 })}
          />
          <Slider
            label="BLOOM / GLOW"
            value={Math.round(config.glow * 100)}
            min={0}
            max={150}
            step={5}
            unit="%"
            onChange={(v) => onChange({ glow: v / 100 })}
          />
        </div>

        <div className="aero-dock__group">
          <Segmented
            label="FLOW COLOR"
            value={config.colorMode}
            options={[
              { id: "velocity" as const, name: "VELOCITY" },
              { id: "pressure" as const, name: "PRESSURE" },
              { id: "acid" as const, name: "ACID" },
            ]}
            onChange={(colorMode) => onChange({ colorMode })}
          />
          <Segmented
            label="FLOW FOCUS"
            value={config.focus}
            options={[
              { id: "both" as const, name: "BOTH" },
              { id: "car" as const, name: "CAR" },
              { id: "bike" as const, name: "BIKE" },
            ]}
            onChange={(focus) => onChange({ focus })}
          />
          <Segmented
            label="CAMERA"
            value={config.camera}
            options={CAMERA_PRESETS}
            onChange={(camera) => onChange({ camera })}
          />
          <Segmented
            label="LIGHTING"
            value={config.lighting}
            options={LIGHTING_PRESETS}
            onChange={(lighting) => onChange({ lighting })}
          />
        </div>

        <div className="aero-dock__group">
          <div className="aero-ctl">
            <span className="aero-ctl__head">
              <span>LIVERY</span>
              <b>{livery.name}</b>
            </span>
            <div className="aero-swatches" role="group" aria-label="Livery">
              {LIVERIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={config.livery === entry.id ? "is-on" : ""}
                  style={{ ["--swatch" as string]: entry.css }}
                  onClick={() => {
                    sound.tick("click");
                    onChange({ livery: entry.id });
                  }}
                  aria-label={`Livery ${entry.name}`}
                  aria-pressed={config.livery === entry.id}
                />
              ))}
            </div>
          </div>
          <div className="aero-toggles">
            <Toggle
              label="AUTO-ORBIT"
              on={config.autoOrbit}
              onChange={(autoOrbit) => onChange({ autoOrbit })}
            />
            <Toggle
              label="GRID FLOOR"
              on={config.grid}
              onChange={(grid) => onChange({ grid })}
            />
          </div>
        </div>

        <div className="aero-dock__actions">
          <button type="button" onClick={onRandomize}>
            RANDOMIZE
          </button>
          <button type="button" onClick={onReset}>
            RESET
          </button>
          <button
            type="button"
            className="aero-dock__export"
            onClick={onExport}
          >
            EXPORT PNG ↓
          </button>
        </div>

        <p className="aero-dock__keys">
          A — TUNNEL · C — CAMERA · L — LIVERY · G — GRID · E — EXPORT
        </p>
      </div>
    </aside>
  );
}