import { CONTROL_BASE, ControlError } from "./control";

/*
 * Client for the local brain layer: model routing, screen copilot, project
 * search, garage crew, memory and workflows. Everything talks to the same
 * loopback daemon as TAKE CONTROL, so there is one process and one config.
 */

export type BrainModel = {
  name: string;
  size: number;
  params: number;
  family: string;
  quant: string;
  vision: boolean;
  embed: boolean;
  code: boolean;
  chat: boolean;
};

export type BrainRoute = {
  role: "fast" | "balanced" | "strong" | "vision" | "code" | "embed";
  label: string;
  hint: string;
  model: string;
  source: "SET" | "AUTO" | "MISSING";
  installed: boolean;
  options: string[];
};

export type BrainLatency = {
  model: string;
  runs: number;
  errors: number;
  lastMs: number | null;
  medianMs: number | null;
  lastNote: string;
};

export type BrainPull = { model: string; status: string; pct: number; error: string; done: boolean };

export type ProjectStatus = {
  status: string;
  root: string;
  files: number;
  chunks: number;
  embedded: number;
  mode: string;
  embedModel: string;
  error: string;
  age: number | null;
  building: boolean;
};

export type CopilotStatus = {
  held: boolean;
  at: string;
  width: number;
  height: number;
  model: string;
  description: string;
  turns: number;
};

export type CrewInfo = {
  id: string;
  name: string;
  tag: string;
  job: string;
  tools: string[];
};

export type BrainSnapshot = {
  ok: boolean;
  endpoint: string;
  models: BrainModel[];
  error: string;
  routing: BrainRoute[];
  latency: BrainLatency[];
  pulls: BrainPull[];
  memory: { count: number; pinned: number; updatedAt: string };
  project: ProjectStatus;
  copilot: CopilotStatus;
  crew: CrewInfo[];
};

export type MemoryNote = {
  id: string;
  text: string;
  tags: string[];
  pinned: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectHit = {
  id: string;
  file: string;
  start: number;
  end: number;
  score: number;
  snippet: string;
};

export type CrewTrace = { tool: string; args: Record<string, unknown>; ms: number; ok: boolean; detail: string };

export type CrewResult = {
  agent: { id: string; name: string; tag: string };
  answer: string;
  model: string;
  trace: CrewTrace[];
  memoryUsed: boolean;
};

export type WorkflowStep = {
  index: number;
  type: string;
  label: string;
  params: Record<string, unknown>;
  needs: { input: boolean; page: boolean; previous: boolean };
};

export type WorkflowPreview = {
  workflow: { id: string; name: string; summary: string };
  steps: WorkflowStep[];
  warnings: string[];
  ready: boolean;
};

export type WorkflowRun = {
  workflow: { id: string; name: string };
  ok: boolean;
  answer?: string;
  failedAt?: number;
  totalMs: number;
  trace: Array<{ index: number; type: string; label: string; ms: number; ok: boolean; output: string; detail: string }>;
};

export type WorkflowInfo = {
  id: string;
  name: string;
  summary: string;
  builtin?: boolean;
  steps: Array<{ type: string; label: string; params: Record<string, unknown> }>;
};

export type EvalRun = { model: string; prompt: string; ms: number; ok: boolean; answer: string; error?: string };
export type EvalResult = {
  runs: EvalRun[];
  byModel: Array<{ model: string; runs: number; failures: number; medianMs: number | null; chars: number }>;
};

const url = (path: string) => `${CONTROL_BASE}${path}`;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 180_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url(path), {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const detail =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Daemon returned ${res.status}`;
      throw new ControlError(detail, res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ControlError("The local brain did not answer in time");
    }
    throw new ControlError(error instanceof Error ? error.message : "The local brain is unreachable");
  } finally {
    window.clearTimeout(timer);
  }
}

const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, timeoutMs);

export function getBrain(): Promise<BrainSnapshot> {
  return request<BrainSnapshot>("/api/brain", {}, 8000);
}

export function setRoute(role: string, model: string): Promise<{ routing: Record<string, string> }> {
  return post<{ routing: Record<string, string> }>("/api/brain/route", { role, model });
}

export function copilotLook(question: string, fresh = false): Promise<{
  answer: string;
  model: string;
  at: string;
  width: number;
  height: number;
}> {
  return post("/api/copilot/look", { question, fresh });
}

export function copilotAsk(question: string): Promise<{ answer: string; model: string; at: string }> {
  return post("/api/copilot/ask", { question });
}

export function reindexProject(): Promise<ProjectStatus> {
  return post<ProjectStatus>("/api/project/reindex", {});
}

export function projectSearch(query: string, limit = 8): Promise<{ query: string; results: ProjectHit[] }> {
  return request<{ query: string; results: ProjectHit[] }>(
    `/api/project/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export function projectAsk(question: string): Promise<{ answer: string; sources: ProjectHit[]; model: string }> {
  return post("/api/project/ask", { question });
}

export function runCrew(agent: string, brief: string): Promise<CrewResult> {
  return post<CrewResult>("/api/crew", { agent, brief });
}

export function listMemory(query = ""): Promise<{ notes: MemoryNote[]; stats: BrainSnapshot["memory"] }> {
  return request(`/api/memory${query ? `?q=${encodeURIComponent(query)}` : ""}`);
}

export function addMemory(text: string, tags = "", pinned = false): Promise<{ note: MemoryNote }> {
  return post("/api/memory", { action: "add", text, tags, pinned });
}

export function updateMemory(
  id: string,
  patch: { text?: string; tags?: string; pinned?: boolean },
): Promise<{ note: MemoryNote }> {
  return post("/api/memory", { action: "update", id, ...patch });
}

export function forgetMemory(id: string): Promise<{ removed: MemoryNote }> {
  return post("/api/memory", { action: "forget", id });
}

export function getWorkflows(): Promise<{ workflows: WorkflowInfo[] }> {
  return request("/api/workflows");
}

export function previewWorkflow(input: {
  id?: string;
  workflow?: unknown;
  input?: string;
  page?: string;
}): Promise<WorkflowPreview> {
  return post<WorkflowPreview>("/api/workflows/preview", input);
}

export function runWorkflow(input: {
  id: string;
  input: string;
  page: string;
  confirm: boolean;
}): Promise<WorkflowRun | { needsConfirm: true; preview: WorkflowPreview }> {
  return post("/api/workflows/run", input);
}

export function saveWorkflow(workflow: Omit<WorkflowInfo, "builtin">): Promise<{ workflow: WorkflowInfo }> {
  return post("/api/workflows", { workflow });
}

export function deleteWorkflow(id: string): Promise<{ removed: number }> {
  return post("/api/workflows", { action: "delete", id });
}

export function runEval(input: {
  prompts: string[];
  models: string[];
  systemPrompt?: string;
}): Promise<EvalResult> {
  return post<EvalResult>("/api/eval", input);
}
