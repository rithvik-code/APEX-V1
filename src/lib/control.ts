export const CONTROL_BASE = (
  (import.meta.env.VITE_APEX_CONTROL_URL as string | undefined) ?? ""
).replace(/\/+$/, "");

export const CAPABILITIES = [
  { key: "screen", label: "SCREEN", detail: "Desktop frames" },
  { key: "accessibility", label: "ACCESS", detail: "UI tree + focus" },
  { key: "mouse", label: "MOUSE", detail: "Pointer + clicks" },
  { key: "keyboard", label: "KEYS", detail: "Typing + shortcuts" },
  { key: "apps", label: "APPS", detail: "Launch + focus" },
  { key: "browser", label: "BROWSER", detail: "Tab control" },
  { key: "files", label: "FILES", detail: "Read + write" },
  { key: "terminal", label: "TERMINAL", detail: "Local commands" },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

export type Permissions = Record<CapabilityKey, boolean>;

export type ControlStatus =
  | "running"
  | "paused"
  | "awaiting"
  | "complete"
  | "stopped"
  | "error";

export type ControlLogEntry = {
  seq: number;
  ts: string;
  type: string;
  title: string;
  detail: string;
  risk: "low" | "medium" | "high" | string;
};

export type ControlAction = {
  action: string;
  args: Record<string, unknown>;
  thought: string;
  verify: string;
  description: string;
};

export type PendingApproval = {
  id: string;
  action: string;
  args: Record<string, unknown>;
  risk: string;
  reason: string;
  createdAt: string;
  description: string;
};

export type ScreenBounds = { x: number; y: number; w: number; h: number };

export type ControlObservation = {
  screen: ScreenBounds | null;
  active: { title?: string; process?: string; pid?: number } | null;
  focused: { name?: string; type?: string; bounds?: string } | null;
  focusedValue: string;
  windows: Array<{ title?: string; process?: string; pid?: number }>;
  elements: Array<Record<string, unknown>>;
  vision: string;
  capturedAt: string;
};

export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  active?: boolean;
};

export type ControlState = {
  id: string;
  goal: string;
  status: ControlStatus;
  step: number;
  maxSteps: number;
  startedAt: number;
  elapsedMs: number;
  doneSummary: string;
  error: string;
  permissions: Permissions;
  autoApprove: boolean;
  vision: boolean;
  ocr: boolean;
  steering: Array<{ text: string; at: number }>;
  plannerModel: string;
  visionModel: string;
  currentAction: ControlAction | null;
  lastResult: string;
  lastVerify: string;
  pendingApproval: PendingApproval | null;
  observation: ControlObservation | null;
  shotUrl: string | null;
  browserTabs: BrowserTab[];
  browserRunning: boolean;
  logs: ControlLogEntry[];
  capabilities: Array<{ key: CapabilityKey; label: string; granted: boolean }>;
};

export type OcrLine = { text: string; x: number; y: number; w: number; h: number };

export type OcrResult = {
  text: string;
  engine: string;
  lines: OcrLine[];
};

export type PullState = {
  model: string;
  status: string;
  pct: number;
  error: string;
  done: boolean;
};

export type LiveInfo = {
  active: boolean;
  users: number;
  fps: number;
  ageMs: number | null;
  lastError: string;
};

export type ModelInfo = {
  name: string;
  vision: boolean;
  tools: boolean;
  size?: number;
};

export type ControlHealth = {
  ok: boolean;
  daemon: string;
  version: string;
  host: string;
  port: number;
  platform: string;
  arch: string;
  node: string;
  ollama: {
    ok: boolean;
    endpoint: string;
    models: ModelInfo[];
    error?: string;
  };
  active: { id: string; status: ControlStatus; step: number } | null;
  live?: LiveInfo;
  defaults: {
    plannerModel: string;
    visionModel: string;
    maxSteps: number;
    fileRoots: string[];
    autoApprove: boolean;
    vision: boolean;
    ocr?: boolean;
  };
};

export type StartMissionInput = {
  goal: string;
  permissions: Permissions;
  autoApprove: boolean;
  vision: boolean;
  ocr: boolean;
  plannerModel: string;
  visionModel: string;
  maxSteps: number;
};

export const ALL_ARMED: Permissions = CAPABILITIES.reduce(
  (acc, item) => ({ ...acc, [item.key]: true }),
  {} as Permissions,
);

export function isActiveStatus(status?: ControlStatus | null): boolean {
  return status === "running" || status === "paused" || status === "awaiting";
}

export function isTerminalStatus(status?: ControlStatus | null): boolean {
  return status === "complete" || status === "stopped" || status === "error";
}

export function controlUrl(path: string): string {
  return `${CONTROL_BASE}${path}`;
}

export function mediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${CONTROL_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ControlError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ControlError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(controlUrl(path), {
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
      throw new ControlError("Control daemon did not answer in time");
    }
    throw new ControlError(
      error instanceof Error ? error.message : "Control daemon is unreachable",
    );
  } finally {
    window.clearTimeout(timer);
  }
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });

export function getHealth(): Promise<ControlHealth> {
  return request<ControlHealth>("/api/health", {}, 4000);
}

export function getState(): Promise<ControlState | null> {
  return request<ControlState | null>("/api/control/state", {}, 6000);
}

export function startMission(input: StartMissionInput): Promise<ControlState> {
  return post<ControlState>("/api/control/start", input);
}

export function pauseMission(): Promise<ControlState> {
  return post<ControlState>("/api/control/pause");
}

export function resumeMission(): Promise<ControlState> {
  return post<ControlState>("/api/control/resume");
}

export function stopMission(reason = "Stopped from the console"): Promise<ControlState> {
  return post<ControlState>("/api/control/stop", { reason });
}

export function approveAction(id: string, allow: boolean): Promise<ControlState> {
  return post<ControlState>("/api/control/approve", { id, allow });
}

export function manualAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ControlState> {
  return post<ControlState>("/api/control/action", { name, args });
}

export function steerMission(text: string): Promise<ControlState> {
  return post<ControlState>("/api/control/steer", { text });
}

export function runOcr(): Promise<OcrResult> {
  return post<OcrResult>("/api/control/ocr", {});
}

export function pullModel(model: string): Promise<{ pull: PullState }> {
  return post<{ pull: PullState }>("/api/control/models/pull", { model });
}

export function cancelPull(model: string): Promise<{ pull: PullState | null }> {
  return post<{ pull: PullState | null }>("/api/control/models/pull", {
    model,
    cancel: true,
  });
}

export function getPulls(): Promise<{ pulls: PullState[] }> {
  return request<{ pulls: PullState[] }>("/api/control/models/pull");
}

export type UndoResult = { restored: number; removed: number };

export function undoWrites(): Promise<UndoResult> {
  return post<UndoResult>("/api/control/undo");
}

export function saveControlConfig(
  patch: Partial<{
    plannerModel: string;
    visionModel: string;
    maxSteps: number;
    autoApprove: boolean;
    vision: boolean;
    ocr: boolean;
    fileRoots: string[];
  }>,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>("/api/control/config", patch);
}
