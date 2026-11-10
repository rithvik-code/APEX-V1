import type { StartMissionInput } from "./control";

export type Playbook = {
  id: string;
  name: string;
  createdAt: number;
  mission: StartMissionInput;
};

const PLAYBOOK_KEY = "apex.playbooks.v1";
const PLAYBOOK_LIMIT = 12;

export function loadPlaybooks(): Playbook[] {
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Playbook[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        entry.mission &&
        typeof entry.mission.goal === "string" &&
        entry.mission.permissions,
    );
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