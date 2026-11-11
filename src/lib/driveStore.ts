/* -------------------------------------------------------------------------- */
/* Time Attack — persistent lap boards and best-lap ghosts, per vehicle.       */
/* -------------------------------------------------------------------------- */

export type DriveVehicle = "car" | "bike";
export type TireCompound = "soft" | "medium" | "hard";

export type DriveSetup = {
  downforce: number; // 0..1 — grip in corners, traded against top speed
  power: number; // 0..1 — acceleration and top speed
  tires: TireCompound;
};

export const DEFAULT_DRIVE_SETUP: DriveSetup = {
  downforce: 0.55,
  power: 0.62,
  tires: "medium",
};

export const TIRE_GRIP: Record<TireCompound, number> = {
  soft: 1,
  medium: 0.82,
  hard: 0.66,
};

export type SectorTimes = [number, number, number];

export type DriveEntry = {
  id: string;
  vehicle: DriveVehicle;
  time: number;
  sectors: SectorTimes;
  setup: DriveSetup;
  date: number;
};

export type GhostSample = {
  t: number;
  x: number;
  z: number;
  h: number;
};

export type GhostLap = {
  vehicle: DriveVehicle;
  time: number;
  samples: GhostSample[];
};

const BOARD_KEY = "apex.drive.board.v2";
const GHOST_KEY = "apex.drive.ghost.v2";
const BOARD_LIMIT = 10;

type BoardMap = Record<DriveVehicle, DriveEntry[]>;
type GhostMap = Record<DriveVehicle, GhostLap | null>;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: unknown, fallback: number): number {
  const n = finite(value);
  return n === null ? fallback : Math.min(1, Math.max(0, n));
}

// Board and ghost data come from localStorage, which may hold entries written
// by an older build or edited by hand. Rejecting bad rows here keeps NaN out of
// the physics loop and out of WebGL transforms.
function sanitizeEntry(raw: unknown): DriveEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const time = finite(value.time);
  if (time === null || time <= 0) return null;
  const sectorsRaw = Array.isArray(value.sectors) ? value.sectors : null;
  if (!sectorsRaw || sectorsRaw.length !== 3) return null;
  const sectors = sectorsRaw.map(finite);
  if (sectors.some((sector) => sector === null || sector < 0)) return null;
  const setupRaw =
    value.setup && typeof value.setup === "object" && !Array.isArray(value.setup)
      ? (value.setup as Record<string, unknown>)
      : {};
  const tires: TireCompound =
    setupRaw.tires === "soft" || setupRaw.tires === "hard" || setupRaw.tires === "medium"
      ? setupRaw.tires
      : DEFAULT_DRIVE_SETUP.tires;
  return {
    id: typeof value.id === "string" && value.id ? value.id : String(time),
    vehicle: value.vehicle === "bike" ? "bike" : "car",
    time,
    sectors: sectors as SectorTimes,
    setup: {
      downforce: clamp01(setupRaw.downforce, DEFAULT_DRIVE_SETUP.downforce),
      power: clamp01(setupRaw.power, DEFAULT_DRIVE_SETUP.power),
      tires,
    },
    date: finite(value.date) ?? Date.now(),
  };
}

function sanitizeGhost(raw: unknown): GhostLap | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const time = finite(value.time);
  if (time === null || time <= 0) return null;
  const samples: GhostSample[] = [];
  for (const item of Array.isArray(value.samples) ? value.samples : []) {
    if (!item || typeof item !== "object") continue;
    const sample = item as Record<string, unknown>;
    const t = finite(sample.t);
    const x = finite(sample.x);
    const z = finite(sample.z);
    const h = finite(sample.h);
    if (t === null || x === null || z === null || h === null || t < 0) continue;
    samples.push({ t, x, z, h });
  }
  if (samples.length < 2) return null;
  samples.sort((a, b) => a.t - b.t);
  return { vehicle: value.vehicle === "bike" ? "bike" : "car", time, samples };
}

function readBoard(): BoardMap {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return { car: [], bike: [] };
    const parsed = JSON.parse(raw) as Partial<BoardMap>;
    const clean = (list: unknown): DriveEntry[] =>
      (Array.isArray(list) ? list : [])
        .map(sanitizeEntry)
        .filter((entry): entry is DriveEntry => entry !== null);
    return {
      car: clean(parsed.car),
      bike: clean(parsed.bike),
    };
  } catch {
    return { car: [], bike: [] };
  }
}

function writeBoard(map: BoardMap): void {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(map));
  } catch {
    // Private-mode storage can throw; the session still runs.
  }
}

export function loadBoard(vehicle: DriveVehicle): DriveEntry[] {
  return readBoard()[vehicle]
    .sort((a, b) => a.time - b.time)
    .slice(0, BOARD_LIMIT);
}

export type SaveResult = {
  board: DriveEntry[];
  rank: number; // 1-based position on the board, 0 if it did not place
  isBest: boolean;
};

export function saveLap(
  vehicle: DriveVehicle,
  time: number,
  sectors: SectorTimes,
  setup: DriveSetup,
): SaveResult {
  const map = readBoard();
  const previousBest = map[vehicle][0]?.time ?? Infinity;
  const entry: DriveEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    vehicle,
    time,
    sectors,
    setup: { ...setup },
    date: Date.now(),
  };
  const next = [...map[vehicle], entry]
    .sort((a, b) => a.time - b.time)
    .slice(0, BOARD_LIMIT);
  map[vehicle] = next;
  writeBoard(map);
  const rank = next.findIndex((e) => e.id === entry.id);
  return {
    board: next,
    rank: rank >= 0 ? rank + 1 : 0,
    isBest: time < previousBest,
  };
}

export function clearBoard(vehicle: DriveVehicle): DriveEntry[] {
  const map = readBoard();
  map[vehicle] = [];
  writeBoard(map);
  return [];
}

function readGhosts(): GhostMap {
  try {
    const raw = localStorage.getItem(GHOST_KEY);
    if (!raw) return { car: null, bike: null };
    const parsed = JSON.parse(raw) as Partial<GhostMap>;
    return { car: parsed.car ?? null, bike: parsed.bike ?? null };
  } catch {
    return { car: null, bike: null };
  }
}

export function loadGhost(vehicle: DriveVehicle): GhostLap | null {
  return sanitizeGhost(readGhosts()[vehicle]);
}

export function saveGhost(vehicle: DriveVehicle, lap: GhostLap): void {
  try {
    const map = readGhosts();
    map[vehicle] = lap;
    localStorage.setItem(GHOST_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearGhost(vehicle: DriveVehicle): void {
  try {
    const map = readGhosts();
    map[vehicle] = null;
    localStorage.setItem(GHOST_KEY, JSON.stringify(map));
  } catch {
    // Ignore.
  }
}

export function formatLap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "--:--.---";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? "+" : "−";
  const abs = Math.abs(seconds);
  return `${sign}${abs.toFixed(3)}`;
}