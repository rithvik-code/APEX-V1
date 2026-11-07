import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveAction,
  controlUrl,
  getHealth,
  getState,
  isActiveStatus,
  manualAction,
  pauseMission,
  resumeMission,
  saveControlConfig,
  startMission,
  stopMission,
  undoWrites,
  type ControlHealth,
  type ControlState,
  type StartMissionInput,
  type UndoResult,
} from "../lib/control";

type ActionLabel =
  | "link"
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "approve"
  | "manual"
  | "undo";

export type ControlApi = {
  health: ControlHealth | null;
  state: ControlState | null;
  online: boolean;
  streaming: boolean;
  connecting: boolean;
  busy: ActionLabel | null;
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  start: (input: StartMissionInput) => Promise<ControlState | null>;
  pause: () => Promise<ControlState | null>;
  resume: () => Promise<ControlState | null>;
  stop: (reason?: string) => Promise<ControlState | null>;
  approve: (id: string, allow: boolean) => Promise<ControlState | null>;
  manual: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<ControlState | null>;
  undo: () => Promise<UndoResult | null>;
  saveConfig: typeof saveControlConfig;
  active: boolean;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Control daemon is unreachable";
}

export function useControl(): ControlApi {
  const [health, setHealth] = useState<ControlHealth | null>(null);
  const [state, setState] = useState<ControlState | null>(null);
  const [online, setOnline] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [busy, setBusy] = useState<ActionLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const apply = useCallback((next: ControlState | null) => {
    if (!mounted.current) return;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    setBusy((current) => current ?? "link");
    try {
      const [nextHealth, nextState] = await Promise.all([
        getHealth(),
        getState().catch(() => null),
      ]);
      if (!mounted.current) return;
      setHealth(nextHealth);
      setOnline(true);
      setConnecting(false);
      setError(null);
      if (nextState) setState(nextState);
    } catch (err) {
      if (!mounted.current) return;
      setOnline(false);
      setConnecting(false);
      setError(messageOf(err));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      getHealth()
        .then((next) => {
          if (!mounted.current) return;
          setHealth(next);
          setOnline(true);
          setConnecting(false);
        })
        .catch(() => {
          if (!mounted.current) return;
          setOnline(false);
        });
    }, 7000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | null = null;

    const connect = () => {
      if (!mounted.current) return;
      source?.close();
      source = new EventSource(controlUrl("/api/control/stream"));
      source.onopen = () => {
        if (!mounted.current) return;
        setStreaming(true);
        setOnline(true);
        setConnecting(false);
      };
      source.addEventListener("state", (event) => {
        if (!mounted.current) return;
        try {
          const parsed = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as ControlState | null;
          setState(parsed);
          setOnline(true);
          setConnecting(false);
          setStreaming(true);
        } catch {
          // A malformed frame is skipped; the next state frame replaces it.
        }
      });
      source.onerror = () => {
        if (!mounted.current) return;
        setStreaming(false);
        if (source?.readyState === EventSource.CLOSED) {
          retry = window.setTimeout(connect, 2200);
        }
      };
    };

    connect();
    return () => {
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, []);

  const run = useCallback(
    async (
      label: ActionLabel,
      task: () => Promise<ControlState | null>,
    ): Promise<ControlState | null> => {
      setBusy(label);
      setError(null);
      try {
        const next = await task();
        if (!mounted.current) return next;
        if (next) setState(next);
        setOnline(true);
        return next;
      } catch (err) {
        if (mounted.current) {
          const message = messageOf(err);
          setError(message);
          if (/unreachable|did not answer|Failed to fetch/i.test(message)) {
            setOnline(false);
          }
        }
        return null;
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [],
  );

  const start = useCallback(
    (input: StartMissionInput) => run("start", () => startMission(input)),
    [run],
  );

  const pause = useCallback(
    () => run("pause", () => pauseMission()),
    [run],
  );

  const resume = useCallback(
    () => run("resume", () => resumeMission()),
    [run],
  );

  const stop = useCallback(
    (reason?: string) => run("stop", () => stopMission(reason)),
    [run],
  );

  const approve = useCallback(
    (id: string, allow: boolean) =>
      run("approve", () => approveAction(id, allow)),
    [run],
  );

  const manual = useCallback(
    (name: string, args: Record<string, unknown> = {}) =>
      run("manual", () => manualAction(name, args)),
    [run],
  );

  const undo = useCallback(async (): Promise<UndoResult | null> => {
    setBusy("undo");
    setError(null);
    try {
      const result = await undoWrites();
      const next = await getState().catch(() => null);
      if (mounted.current && next) apply(next);
      return result;
    } catch (err) {
      if (mounted.current) setError(messageOf(err));
      return null;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [apply]);

  return {
    health,
    state,
    online,
    streaming,
    connecting,
    busy,
    error,
    clearError: () => setError(null),
    refresh,
    start,
    pause,
    resume,
    stop,
    approve,
    manual,
    undo,
    saveConfig: saveControlConfig,
    active: isActiveStatus(state?.status),
  };
}
