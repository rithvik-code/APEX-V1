import type { FlowColorMode } from "../three/aero";

export type { FlowColorMode };
export type CameraPreset = "hero" | "side" | "top" | "wing";
export type LightingPreset = "studio" | "midnight" | "neon";
export type AeroFocus = "both" | "car" | "bike";
export type Weather = "clear" | "rain";

export type CustomPaint = {
  enabled: boolean;
  base: string;
  accent: string;
  number: string;
  stripe: boolean;
};

export type SceneConfig = {
  aero: boolean;
  windSpeed: number;
  density: number;
  turbulence: number;
  timeScale: number;
  glow: number;
  colorMode: FlowColorMode;
  focus: AeroFocus;
  camera: CameraPreset;
  lighting: LightingPreset;
  livery: string;
  autoOrbit: boolean;
  grid: boolean;
  weather: Weather;
  rainAmount: number;
  nightRace: boolean;
  explode: number;
  dyno: boolean;
  rpm: number;
  paint: CustomPaint;
};

export const DEFAULT_PAINT: CustomPaint = {
  enabled: false,
  base: "#aab2ba",
  accent: "#c8ff16",
  number: "01",
  stripe: true,
};

export const DEFAULT_SCENE: SceneConfig = {
  aero: false,
  windSpeed: 180,
  density: 0.7,
  turbulence: 0.35,
  timeScale: 1,
  glow: 0.6,
  colorMode: "velocity",
  focus: "both",
  camera: "hero",
  lighting: "studio",
  livery: "silver",
  autoOrbit: false,
  grid: true,
  weather: "clear",
  rainAmount: 0.6,
  nightRace: false,
  explode: 0,
  dyno: false,
  rpm: 0.32,
  paint: { ...DEFAULT_PAINT },
};

export const LIVERIES = [
  { id: "silver", name: "LIQUID SILVER", hex: 0xaab2ba, css: "#aab2ba" },
  { id: "graphite", name: "GRAPHITE", hex: 0x23282c, css: "#3a4247" },
  { id: "acid", name: "ACID", hex: 0xc8ff16, css: "#c8ff16" },
  { id: "magenta", name: "MAGENTA", hex: 0xff2fb3, css: "#ff2fb3" },
  { id: "ember", name: "EMBER", hex: 0xff5a1f, css: "#ff5a1f" },
  { id: "azure", name: "AZURE", hex: 0x2f7bff, css: "#2f7bff" },
  { id: "titanium", name: "TITANIUM", hex: 0x7c8792, css: "#7c8792" },
  { id: "sector", name: "SECTOR", hex: 0xff4d2e, css: "#ff4d2e" },
] as const;

export const CAMERA_PRESETS: Array<{ id: CameraPreset; name: string }> = [
  { id: "hero", name: "HERO" },
  { id: "side", name: "SIDE" },
  { id: "top", name: "TOP" },
  { id: "wing", name: "WING" },
];

export const LIGHTING_PRESETS: Array<{ id: LightingPreset; name: string }> = [
  { id: "studio", name: "STUDIO" },
  { id: "midnight", name: "MIDNIGHT" },
  { id: "neon", name: "NEON" },
];

export function aeroTelemetry(windSpeed: number): {
  downforceKg: number;
  dragN: number;
  efficiency: number;
} {
  const v = windSpeed / 3.6;
  const q = 0.5 * 1.225 * v * v;
  const downforceN = q * 2.55;
  const dragN = q * 0.92;
  return {
    downforceKg: downforceN / 9.81,
    dragN,
    efficiency: downforceN / dragN,
  };
}

/* -------------------------------------------------------------------------- */
/* Dyno — a 6.5L V12 biturbo power band.                                       */
/* -------------------------------------------------------------------------- */

export const RPM_IDLE = 1000;
export const RPM_REDLINE = 12000;

export function rpmValue(norm: number): number {
  const clamped = Math.min(1, Math.max(0, norm));
  return Math.round(RPM_IDLE + clamped * (RPM_REDLINE - RPM_IDLE));
}

export type DynoPoint = {
  rpm: number;
  torqueNm: number;
  powerHp: number;
};

// Torque builds through the mid-range and tails off past the cam peak; power
// is torque × rpm, so it keeps climbing toward the redline. HP = Nm·rpm / 7127.
export function dynoPoint(norm: number): DynoPoint {
  const rpm = rpmValue(norm);
  const n = Math.min(1, Math.max(0, norm));
  const torqueNm = 640 * (0.46 + 0.54 * Math.sin(Math.PI * Math.min(1, n * 0.94)));
  const powerHp = (torqueNm * rpm) / 7127;
  return { rpm, torqueNm, powerHp };
}

export function dynoSweep(samples = 48): DynoPoint[] {
  const out: DynoPoint[] = [];
  for (let i = 0; i <= samples; i++) out.push(dynoPoint(i / samples));
  return out;
}

export function dynoPeak(): { torqueNm: number; torqueRpm: number; powerHp: number; powerRpm: number } {
  let peakT = { torqueNm: 0, rpm: 0 };
  let peakP = { powerHp: 0, rpm: 0 };
  for (const point of dynoSweep(120)) {
    if (point.torqueNm > peakT.torqueNm) peakT = { torqueNm: point.torqueNm, rpm: point.rpm };
    if (point.powerHp > peakP.powerHp) peakP = { powerHp: point.powerHp, rpm: point.rpm };
  }
  return {
    torqueNm: peakT.torqueNm,
    torqueRpm: peakT.rpm,
    powerHp: peakP.powerHp,
    powerRpm: peakP.rpm,
  };
}

/* -------------------------------------------------------------------------- */
/* Setup share codes — a full build serialized to a short, URL-safe string.    */
/* -------------------------------------------------------------------------- */

const CODE_PREFIX = "APX1.";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The tunnel toggle is transient view state, not part of a shareable build.
export function encodeSetup(config: SceneConfig): string {
  const { aero: _aero, ...rest } = config;
  const json = JSON.stringify(rest);
  const bytes = new TextEncoder().encode(json);
  return CODE_PREFIX + toBase64Url(bytes);
}

const COLOR_MODES = new Set<FlowColorMode>(["velocity", "pressure", "acid"]);
const FOCUS_VALUES = new Set<AeroFocus>(["both", "car", "bike"]);
const WEATHER_VALUES = new Set<Weather>(["clear", "rain"]);
const CAMERA_IDS = new Set<CameraPreset>(CAMERA_PRESETS.map((preset) => preset.id));
const LIGHTING_IDS = new Set<LightingPreset>(LIGHTING_PRESETS.map((preset) => preset.id));
const LIVERY_IDS = new Set<string>(LIVERIES.map((livery) => livery.id));

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Share codes and saved garage entries both cross a trust boundary: either can
// be hand-edited or produced by an older build. Every field is whitelisted and
// numeric ranges are clamped so a bad value cannot crash the render loop.
export function sanitizeSceneConfig(input: unknown): SceneConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const paintRaw =
    value.paint && typeof value.paint === "object" && !Array.isArray(value.paint)
      ? (value.paint as Record<string, unknown>)
      : {};
  const pick = <T extends string>(candidate: unknown, allowed: Set<T>, fallback: T): T =>
    typeof candidate === "string" && allowed.has(candidate as T) ? (candidate as T) : fallback;
  return {
    aero: flag(value.aero, DEFAULT_SCENE.aero),
    windSpeed: boundedNumber(value.windSpeed, DEFAULT_SCENE.windSpeed, 40, 400),
    density: boundedNumber(value.density, DEFAULT_SCENE.density, 0.01, 1),
    turbulence: boundedNumber(value.turbulence, DEFAULT_SCENE.turbulence, 0, 1),
    timeScale: boundedNumber(value.timeScale, DEFAULT_SCENE.timeScale, 0.1, 2),
    glow: boundedNumber(value.glow, DEFAULT_SCENE.glow, 0, 1.5),
    colorMode: pick(value.colorMode, COLOR_MODES, DEFAULT_SCENE.colorMode),
    focus: pick(value.focus, FOCUS_VALUES, DEFAULT_SCENE.focus),
    camera: pick(value.camera, CAMERA_IDS, DEFAULT_SCENE.camera),
    lighting: pick(value.lighting, LIGHTING_IDS, DEFAULT_SCENE.lighting),
    livery: pick(value.livery, LIVERY_IDS, DEFAULT_SCENE.livery),
    autoOrbit: flag(value.autoOrbit, DEFAULT_SCENE.autoOrbit),
    grid: flag(value.grid, DEFAULT_SCENE.grid),
    weather: pick(value.weather, WEATHER_VALUES, DEFAULT_SCENE.weather),
    rainAmount: boundedNumber(value.rainAmount, DEFAULT_SCENE.rainAmount, 0, 1),
    nightRace: flag(value.nightRace, DEFAULT_SCENE.nightRace),
    explode: boundedNumber(value.explode, DEFAULT_SCENE.explode, 0, 1),
    dyno: flag(value.dyno, DEFAULT_SCENE.dyno),
    rpm: boundedNumber(value.rpm, DEFAULT_SCENE.rpm, 0, 1),
    paint: {
      enabled: flag(paintRaw.enabled, DEFAULT_PAINT.enabled),
      base: typeof paintRaw.base === "string" ? paintRaw.base : DEFAULT_PAINT.base,
      accent: typeof paintRaw.accent === "string" ? paintRaw.accent : DEFAULT_PAINT.accent,
      number:
        typeof paintRaw.number === "string"
          ? paintRaw.number.slice(0, 3)
          : DEFAULT_PAINT.number,
      stripe: flag(paintRaw.stripe, DEFAULT_PAINT.stripe),
    },
  };
}

export function decodeSetup(code: string): Partial<SceneConfig> | null {
  const trimmed = code.trim();
  const body = trimmed.startsWith(CODE_PREFIX)
    ? trimmed.slice(CODE_PREFIX.length)
    : trimmed;
  if (!body) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const safe = sanitizeSceneConfig(parsed);
    if (!safe) return null;
    const patch: Partial<SceneConfig> = {};
    for (const key of Object.keys(DEFAULT_SCENE) as Array<keyof SceneConfig>) {
      if (key === "aero" || key === "paint") continue;
      if (parsed[key] !== undefined) {
        (patch as Record<string, unknown>)[key] = safe[key];
      }
    }
    if (parsed.paint !== undefined) patch.paint = safe.paint;
    return Object.keys(patch).length ? patch : null;
  } catch {
    return null;
  }
}

export function setupShareUrl(config: SceneConfig): string {
  const code = encodeSetup(config);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#setup=${code}`;
}

export function readSetupFromUrl(): Partial<SceneConfig> | null {
  const match = window.location.hash.match(/setup=([^&]+)/);
  if (!match) return null;
  return decodeSetup(decodeURIComponent(match[1]));
}

/* -------------------------------------------------------------------------- */
/* Garage — persistent saved machines in this browser.                         */
/* -------------------------------------------------------------------------- */

export type GarageEntry = {
  id: string;
  name: string;
  createdAt: number;
  config: SceneConfig;
};

const GARAGE_KEY = "apex.garage.v1";
const GARAGE_LIMIT = 24;

export function loadGarage(): GarageEntry[] {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: GarageEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string" || !value.id) continue;
      const config = sanitizeSceneConfig(value.config);
      if (!config) continue;
      entries.push({
        id: value.id,
        name:
          typeof value.name === "string" && value.name.trim()
            ? value.name.trim().slice(0, 28)
            : "UNTITLED BUILD",
        createdAt:
          typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
            ? value.createdAt
            : Date.now(),
        config,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function persistGarage(entries: GarageEntry[]): void {
  try {
    localStorage.setItem(GARAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable in private contexts; the session still works.
  }
}

export function saveToGarage(name: string, config: SceneConfig): GarageEntry {
  const entry: GarageEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 28) || "UNTITLED BUILD",
    createdAt: Date.now(),
    config: { ...config, paint: { ...config.paint } },
  };
  const next = [entry, ...loadGarage()].slice(0, GARAGE_LIMIT);
  persistGarage(next);
  return entry;
}

export function removeFromGarage(id: string): GarageEntry[] {
  const next = loadGarage().filter((entry) => entry.id !== id);
  persistGarage(next);
  return next;
}