import type { FlowColorMode } from "../three/aero";

export type { FlowColorMode };
export type CameraPreset = "hero" | "side" | "top" | "wing";
export type LightingPreset = "studio" | "midnight" | "neon";
export type AeroFocus = "both" | "car" | "bike";

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
};

export const LIVERIES = [
  { id: "silver", name: "LIQUID SILVER", hex: 0xaab2ba, css: "#aab2ba" },
  { id: "graphite", name: "GRAPHITE", hex: 0x23282c, css: "#3a4247" },
  { id: "acid", name: "ACID", hex: 0xc8ff16, css: "#c8ff16" },
  { id: "magenta", name: "MAGENTA", hex: 0xff2fb3, css: "#ff2fb3" },
  { id: "ember", name: "EMBER", hex: 0xff5a1f, css: "#ff5a1f" },
  { id: "azure", name: "AZURE", hex: 0x2f7bff, css: "#2f7bff" },
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