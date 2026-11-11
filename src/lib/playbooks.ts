import type { Permissions, StartMissionInput } from "./control";

export type Playbook = {
  id: string;
  name: string;
  createdAt: number;
  mission: StartMissionInput;
};

const PLAYBOOK_KEY = "apex.playbooks.v1";
const PLAYBOOK_LIMIT = 12;

function sanitizePlaybook(raw: unknown): Playbook | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const missionRaw =
    value.mission && typeof value.mission === "object" && !Array.isArray(value.mission)
      ? (value.mission as Record<string, unknown>)
      : null;
  if (!missionRaw) return null;
  const goal = typeof missionRaw.goal === "string" ? missionRaw.goal.trim() : "";
  if (!goal) return null;
  const permissionsRaw =
    missionRaw.permissions &&
    typeof missionRaw.permissions === "object" &&
    !Array.isArray(missionRaw.permissions)
      ? (missionRaw.permissions as Record<string, unknown>)
      : {};
  const permissions: Permissions = {} as Permissions;
  for (const [key, granted] of Object.entries(permissionsRaw)) {
    if (granted === true) (permissions as Record<string, boolean>)[key] = true;
  }
  const maxSteps = Number(missionRaw.maxSteps);
  const createdAt = Number(value.createdAt);
  return {
    id: value.id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 28)
        : goal.slice(0, 28),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    mission: {
      goal,
      permissions,
      autoApprove: missionRaw.autoApprove === true,
      vision: missionRaw.vision === true,
      ocr: missionRaw.ocr !== false,
      plannerModel:
        typeof missionRaw.plannerModel === "string" && missionRaw.plannerModel
          ? missionRaw.plannerModel
          : "qwen3:4b",
      visionModel:
        typeof missionRaw.visionModel === "string" && missionRaw.visionModel
          ? missionRaw.visionModel
          : "gemma3:4b",
      maxSteps: Number.isFinite(maxSteps)
        ? Math.max(1, Math.min(60, Math.floor(maxSteps)))
        : 20,
    },
  };
}

export function loadPlaybooks(): Playbook[] {
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizePlaybook)
      .filter((entry): entry is Playbook => entry !== null)
      .slice(0, PLAYBOOK_LIMIT);
  } catch {
    return [];
  }
}

function persist(entries: Playbook[]): void {
  try {
    localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable in private contexts; the session still works.
  }
}

export function savePlaybook(name: string, mission: StartMissionInput): Playbook {
  const entry: Playbook = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 28) || mission.goal.trim().slice(0, 28) || "UNTITLED MISSION",
    createdAt: Date.now(),
    mission: { ...mission, permissions: { ...mission.permissions } },
  };
  persist([entry, ...loadPlaybooks()].slice(0, PLAYBOOK_LIMIT));
  return entry;
}

export function removePlaybook(id: string): Playbook[] {
  const next = loadPlaybooks().filter((entry) => entry.id !== id);
  persist(next);
  return next;
}