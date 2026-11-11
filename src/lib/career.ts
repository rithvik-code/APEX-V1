import { loadArcadeStats } from "./arcade";

/* -------------------------------------------------------------------------- */
/* Constructor Series — the garage's racing ladder.                           */
/* CP (Constructor Points) are earned from real use; licences unlock parts.   */
/* -------------------------------------------------------------------------- */

export type UnlockId =
  | "titaniumLivery"
  | "wheelCovers"
  | "canards"
  | "headlamp"
  | "flame"
  | "plateFrame"
  | "sectorLivery"
  | "ghostTrail"
  | "tailStrip"
  | "gurney"
  | "cockpitGlow"
  | "fullKit"
  | "chrome"
  | "pulse"
  | "wingBadge"
  | "wear"
  | "soot"
  | "veteran";

export type Licence = {
  index: number;
  name: string;
  short: string;
  cp: number;
  color: string;
  perk: string;
  unlocks: UnlockId[];
};

export const LICENCES: Licence[] = [
  {
    index: 1,
    name: "ROOKIE",
    short: "R",
    cp: 0,
    color: "#9aa4ad",
    perk: "BASE SPEC",
    unlocks: [],
  },
  {
    index: 2,
    name: "BRONZE",
    short: "BR",
    cp: 150,
    color: "#c98a4b",
    perk: "TITANIUM LIVERY · WHEEL COVERS",
    unlocks: ["titaniumLivery", "wheelCovers"],
  },
  {
    index: 3,
    name: "SILVER",
    short: "SI",
    cp: 400,
    color: "#cfd6dc",
    perk: "FRONT CANARDS · HEADLAMP TINT",
    unlocks: ["canards", "headlamp"],
  },
  {
    index: 4,
    name: "GOLD",
    short: "GD",
    cp: 800,
    color: "#e7c25a",
    perk: "EXHAUST FLAME · PLATE FRAME",
    unlocks: ["flame", "plateFrame"],
  },
  {
    index: 5,
    name: "PLATINUM",
    short: "PT",
    cp: 1400,
    color: "#d8fff2",
    perk: "SECTOR LIVERY · GHOST TRAIL · TAIL STRIP",
    unlocks: ["sectorLivery", "ghostTrail", "tailStrip"],
  },
  {
    index: 6,
    name: "SUPER LICENCE",
    short: "SL",
    cp: 2200,
    color: "#b18cff",
    perk: "REAR GURNEY · COCKPIT GLOW",
    unlocks: ["gurney", "cockpitGlow"],
  },
  {
    index: 7,
    name: "WORLD CHAMPION",
    short: "WC",
    cp: 3200,
    color: "#ffd166",
    perk: "FULL AERO KIT · CHROME FINISH",
    unlocks: ["fullKit", "chrome"],
  },
  {
    index: 8,
    name: "LEGEND",
    short: "LG",
    cp: 4500,
    color: "#ff5fa2",
    perk: "PULSING ACCENT · WING BADGE",
    unlocks: ["pulse", "wingBadge"],
  },
];

export const UNLOCK_LABELS: Record<UnlockId, string> = {
  titaniumLivery: "TITANIUM LIVERY",
  wheelCovers: "WHEEL COVERS",
  canards: "FRONT CANARDS",
  headlamp: "HEADLAMP TINT",
  flame: "EXHAUST FLAME",
  plateFrame: "PLATE FRAME",
  sectorLivery: "SECTOR LIVERY",
  ghostTrail: "GHOST TRAIL COLOR",
  tailStrip: "TAIL LIGHT STRIP",
  gurney: "REAR GURNEY",
  cockpitGlow: "COCKPIT GLOW",
  fullKit: "FULL AERO KIT",
  chrome: "CHROME FINISH",
  pulse: "PULSING ACCENT",
  wingBadge: "WING BADGE",
  wear: "PAINT WEAR",
  soot: "EXHAUST SOOT",
  veteran: "VETERAN BADGE",
};

export type CareerKind = "quiz" | "chat" | "lap" | "mission" | "setup" | "ghost";

export type CareerEvent = {
  kind: CareerKind;
  id: string;
  cp?: number;
  entryId?: string;
};

export const PADDOCK_KINDS = [
  "NODE",
  "PYTHON",
  "RUST",
  "GO",
  "DOTNET",
  "WEB",
  "GIT",
  "FOLDER",
  "UNKNOWN",
] as const;

export type PaddockKind = (typeof PADDOCK_KINDS)[number];

export type PaddockProject = {
  id: string;
  name: string;
  kind: PaddockKind;
  files: number;
  updatedAt: number;
  branch: string;
  lastCommitAt: number;
};

export type PaddockEntry = {
  id: string;
  cp: number;
  missions: number;
  lastAt: number;
};

export type CareerState = {
  cp: number;
  distanceM: number;
  licence: number;
  eventIds: string[];
  activeDays: string[];
  paddock: PaddockProject[];
  entries: PaddockEntry[];
  lastAt: number;
};

export type AwardResult = {
  state: CareerState;
  gained: number;
  rankUp: Licence | null;
};

const CAREER_KEY = "apex.career.v1";
const EVENT_LIMIT = 300;
const DAY_LIMIT = 60;
const PADDOCK_LIMIT = 40;
const CP_LIMIT = 10_000_000;
const DISTANCE_LIMIT = 100_000_000;
const LAP_DAILY_CAP = 10;
const MISSION_DAILY_CAP = 5;

const BASE_CP: Record<CareerKind, number> = {
  quiz: 15,
  chat: 5,
  lap: 25,
  mission: 40,
  setup: 5,
  ghost: 10,
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function count(value: unknown, max: number): number {
  const n = finite(value, 0);
  return Math.min(max, Math.max(0, Math.floor(n)));
}

export function careerDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function licenceFor(cp: number): number {
  let index = 1;
  for (const licence of LICENCES) {
    if (cp >= licence.cp) index = licence.index;
  }
  return index;
}

export function currentLicence(cp: number): Licence {
  return LICENCES[licenceFor(cp) - 1];
}

export function nextLicence(cp: number): Licence | null {
  const index = licenceFor(cp);
  return index < LICENCES.length ? LICENCES[index] : null;
}

export function licenceProgress(cp: number): number {
  const current = currentLicence(cp);
  const next = nextLicence(cp);
  if (!next) return 1;
  const span = next.cp - current.cp;
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (cp - current.cp) / span));
}

export function unlockSet(state: Pick<CareerState, "cp" | "distanceM">): Set<UnlockId> {
  const unlocks = new Set<UnlockId>();
  const index = licenceFor(state.cp);
  for (const licence of LICENCES) {
    if (licence.index > index) break;
    for (const unlock of licence.unlocks) unlocks.add(unlock);
  }
  if (state.distanceM >= 1000) unlocks.add("wear");
  if (state.distanceM >= 5000) unlocks.add("soot");
  if (state.distanceM >= 15000) unlocks.add("veteran");
  return unlocks;
}

export function unlockCount(state: Pick<CareerState, "cp" | "distanceM">): number {
  return unlockSet(state).size;
}

export function formatKm(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return "0 KM";
  if (distanceM < 1000) return `${Math.round(distanceM)} M`;
  return `${(distanceM / 1000).toFixed(distanceM < 10000 ? 2 : 1)} KM`;
}

function sanitizeProject(raw: unknown): PaddockProject | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const kind = PADDOCK_KINDS.includes(value.kind as PaddockKind)
    ? (value.kind as PaddockKind)
    : "UNKNOWN";
  return {
    id: value.id.slice(0, 40),
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 40)
        : "UNTITLED",
    kind,
    files: count(value.files, 1_000_000),
    updatedAt: count(value.updatedAt, 8_640_000_000_000_000),
    branch: typeof value.branch === "string" ? value.branch.slice(0, 40) : "",
    lastCommitAt: count(value.lastCommitAt, 8_640_000_000_000_000),
  };
}

function sanitizeEntries(raw: unknown): PaddockEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: PaddockEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id) continue;
    entries.push({
      id: value.id.slice(0, 40),
      cp: count(value.cp, CP_LIMIT),
      missions: count(value.missions, 1_000_000),
      lastAt: count(value.lastAt, 8_640_000_000_000_000),
    });
    if (entries.length >= PADDOCK_LIMIT) break;
  }
  return entries;
}

function emptyCareer(cp = 0): CareerState {
  return {
    cp: Math.min(CP_LIMIT, Math.max(0, Math.floor(cp))),
    distanceM: 0,
    licence: licenceFor(cp),
    eventIds: [],
    activeDays: [],
    paddock: [],
    entries: [],
    lastAt: Date.now(),
  };
}

export function loadCareer(): CareerState {
  try {
    const raw = localStorage.getItem(CAREER_KEY);
    if (!raw) {
      // First run: carry over arcade points so existing progress is not lost.
      return emptyCareer(loadArcadeStats().xp);
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyCareer();
    }
    const cp = count(parsed.cp, CP_LIMIT);
    const distanceM = count(parsed.distanceM, DISTANCE_LIMIT);
    const licence = Math.min(
      licenceFor(cp),
      Math.max(1, count(parsed.licence, LICENCES.length)),
    );
    const eventIds = Array.isArray(parsed.eventIds)
      ? parsed.eventIds.filter((id): id is string => typeof id === "string").slice(-EVENT_LIMIT)
      : [];
    const activeDays = Array.isArray(parsed.activeDays)
      ? parsed.activeDays
          .filter((day): day is string => typeof day === "string" && DAY_RE.test(day))
          .slice(-DAY_LIMIT)
      : [];
    const paddock = Array.isArray(parsed.paddock)
      ? parsed.paddock
          .map(sanitizeProject)
          .filter((project): project is PaddockProject => project !== null)
          .slice(0, PADDOCK_LIMIT)
      : [];
    return {
      cp,
      distanceM,
      licence,
      eventIds,
      activeDays,
      paddock,
      entries: sanitizeEntries(parsed.entries),
      lastAt: count(parsed.lastAt, 8_640_000_000_000_000) || Date.now(),
    };
  } catch {
    return emptyCareer();
  }
}

export function saveCareer(state: CareerState): void {
  try {
    localStorage.setItem(CAREER_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked; the session still works.
  }
}

export function setPaddock(state: CareerState, projects: PaddockProject[]): CareerState {
  const sanitized = projects
    .map(sanitizeProject)
    .filter((project): project is PaddockProject => project !== null)
    .slice(0, PADDOCK_LIMIT);
  const known = new Map(state.entries.map((entry) => [entry.id, entry]));
  const entries = sanitized.map(
    (project) =>
      known.get(project.id) ?? {
        id: project.id,
        cp: 0,
        missions: 0,
        lastAt: 0,
      },
  );
  const next: CareerState = { ...state, paddock: sanitized, entries };
  saveCareer(next);
  return next;
}

export function entryFor(state: CareerState, id: string): PaddockEntry | null {
  return state.entries.find((entry) => entry.id === id) ?? null;
}

export function awardCareer(state: CareerState, event: CareerEvent): AwardResult {
  const day = careerDayKey();
  const rawId = event.id.slice(0, 80);
  const effectiveId =
    event.kind === "chat"
      ? `chat-${day}`
      : event.kind === "quiz"
        ? `quiz-${day}-${rawId}`
        : event.kind === "lap"
          ? `lap-${day}-${rawId}`
          : event.kind === "mission"
            ? `mission-${day}-${rawId}`
            : rawId;

  if (!effectiveId || state.eventIds.includes(effectiveId)) {
    return { state, gained: 0, rankUp: null };
  }

  let gained = event.cp ?? BASE_CP[event.kind];
  if (!Number.isFinite(gained)) gained = 0;
  gained = Math.min(200, Math.max(0, Math.round(gained)));

  if (
    event.kind === "lap" &&
    state.eventIds.filter((id) => id.startsWith(`lap-${day}-`)).length >= LAP_DAILY_CAP
  ) {
    return { state, gained: 0, rankUp: null };
  }
  if (
    event.kind === "mission" &&
    state.eventIds.filter((id) => id.startsWith(`mission-${day}-`)).length >= MISSION_DAILY_CAP
  ) {
    return { state, gained: 0, rankUp: null };
  }

  const cp = Math.min(CP_LIMIT, state.cp + gained);
  const previousLicence = Math.min(state.licence, licenceFor(state.cp));
  const nextLicenceIndex = licenceFor(cp);
  const rankUp = nextLicenceIndex > previousLicence ? LICENCES[nextLicenceIndex - 1] : null;

  let entries = state.entries;
  if (event.entryId) {
    const index = entries.findIndex((entry) => entry.id === event.entryId);
    if (index >= 0) {
      const updated: PaddockEntry = {
        ...entries[index],
        cp: Math.min(CP_LIMIT, entries[index].cp + gained),
        missions: entries[index].missions + (event.kind === "mission" ? 1 : 0),
        lastAt: Date.now(),
      };
      entries = entries.map((entry, i) => (i === index ? updated : entry));
    }
  }

  const activeDays = state.activeDays.includes(day)
    ? state.activeDays
    : [...state.activeDays, day].slice(-DAY_LIMIT);

  const next: CareerState = {
    ...state,
    cp,
    licence: Math.max(state.licence, nextLicenceIndex),
    eventIds: [...state.eventIds, effectiveId].slice(-EVENT_LIMIT),
    activeDays,
    entries,
    lastAt: Date.now(),
  };
  saveCareer(next);
  return { state: next, gained, rankUp };
}

export function addDistance(state: CareerState, meters: number): CareerState {
  if (!Number.isFinite(meters) || meters <= 0) return state;
  const distanceM = Math.min(DISTANCE_LIMIT, state.distanceM + meters);
  const next = { ...state, distanceM, lastAt: Date.now() };
  saveCareer(next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Career card — the shareable artifact.                                      */
/* -------------------------------------------------------------------------- */

export type CareerCardData = {
  licence: Licence;
  cp: number;
  nextCp: number | null;
  distanceM: number;
  bestCar: number | null;
  bestBike: number | null;
  constructors: number;
  unlocks: number;
  unlockTotal: number;
};

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function lapText(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "--:--.---";
  const m = Math.floor(value / 60);
  const s = Math.floor(value % 60);
  const ms = Math.floor((value % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function paintCareerCard(canvas: HTMLCanvasElement, data: CareerCardData): void {
  const W = 960;
  const H = 540;
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.82, H * 0.22, 20, W * 0.82, H * 0.22, 460);
  glow.addColorStop(0, "rgba(200,255,22,0.18)");
  glow.addColorStop(0.55, "rgba(200,255,22,0.04)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#c8ff16";
  ctx.fillRect(48, 0, 2, H);

  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#c8ff16";
  ctx.fillText("APEX // CONSTRUCTOR SERIES", 64, 66);

  ctx.font = "800 62px 'Archivo', Arial, sans-serif";
  ctx.fillStyle = "#f2f4ee";
  const nameLines = wrap(ctx, data.licence.name, 520);
  nameLines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, 64, 140 + index * 64);
  });

  ctx.fillStyle = data.licence.color;
  ctx.font = "600 15px 'IBM Plex Mono', monospace";
  ctx.fillText(`LICENCE ${String(data.licence.index).padStart(2, "0")} / 08`, 64, 236);

  const progress = data.nextCp
    ? Math.min(1, Math.max(0, (data.cp - data.licence.cp) / (data.nextCp - data.licence.cp)))
    : 1;
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(64, 258, 340, 5);
  ctx.fillStyle = "#c8ff16";
  ctx.fillRect(64, 258, 340 * progress, 5);

  ctx.font = "800 42px 'Archivo', Arial, sans-serif";
  ctx.fillStyle = "#c8ff16";
  ctx.fillText(`${data.cp.toLocaleString()} CP`, 64, 330);
  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(236,240,230,0.55)";
  ctx.fillText(
    data.nextCp ? `NEXT LICENCE AT ${data.nextCp.toLocaleString()} CP` : "TOP LICENCE REACHED",
    64,
    354,
  );

  const stats: Array<[string, string]> = [
    ["ODOMETER", formatKm(data.distanceM)],
    ["CAR BEST", lapText(data.bestCar)],
    ["BIKE BEST", lapText(data.bestBike)],
    ["CONSTRUCTORS", String(data.constructors)],
    ["UNLOCKS", `${data.unlocks}/${data.unlockTotal}`],
  ];
  stats.forEach(([label, value], index) => {
    const y = 404 + index * 26;
    ctx.font = "500 12px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(236,240,230,0.45)";
    ctx.fillText(label, 64, y);
    ctx.font = "600 14px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#e9ede8";
    ctx.fillText(value, 196, y);
  });

  ctx.strokeStyle = "rgba(200,255,22,0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(760, 250, 88, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.strokeStyle = data.licence.color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(760, 250, 88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "800 54px 'Archivo', Arial, sans-serif";
  ctx.fillStyle = data.licence.color;
  ctx.fillText(data.licence.short, 760, 263);
  ctx.font = "500 11px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(236,240,230,0.5)";
  ctx.fillText("LICENCE", 760, 288);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(236,240,230,0.42)";
  ctx.font = "500 12px 'IBM Plex Mono', monospace";
  ctx.fillText("APEX // CAREER CARD", 64, 506);
  const date = new Date().toISOString().slice(0, 10);
  ctx.fillText(date, 830, 506);
}
