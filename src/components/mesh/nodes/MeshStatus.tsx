import type { MeshNodeProps } from "../types";
import { useCallback, useEffect, useRef, useState } from "react";
import { knowledgeState } from "../../../lib/knowledge";

type ProbeState = "probing" | "online" | "offline";

type ProbeResult = {
  state: ProbeState;
  detail: string;
};

type ProbeDef = {
  id: string;
  name: string;
  target: string;
  url: string;
  detail: (body: string) => string;
};

const PROBES: ProbeDef[] = [
  {
    id: "ollama",
    name: "OLLAMA",
    target: "127.0.0.1:11434",
    url: "http://127.0.0.1:11434/api/tags",
    detail: (body) => {
      try {
        const models = (JSON.parse(body) as { models?: Array<{ name?: string }> }).models ?? [];
        return models.length ? `${models.length} MODELS · ${models.slice(0, 3).map((m) => m.name).join(", ")}` : "DAEMON UP · NO MODELS PULLED";
      } catch {
        return "DAEMON UP";
      }
    },
  },
  {
    id: "sd",
    name: "SD WEBUI",
    target: "127.0.0.1:7860",
    url: "http://127.0.0.1:7860/sdapi/v1/sd-models",
    detail: (body) => {
      try {
        const models = JSON.parse(body) as Array<{ title?: string }>;
        return models.length ? `${models.length} CHECKPOINTS · ${String(models[0].title ?? "").slice(0, 34)}` : "API UP · NO CHECKPOINTS";
      } catch {
        return "API UP";
      }
    },
  },
  {
    id: "llamacpp",
    name: "LLAMA.CPP",
    target: "127.0.0.1:8080",
    url: "http://127.0.0.1:8080/health",
    detail: () => "SERVER UP",
  },
  {
    id: "piper",
    name: "PIPER TTS",
    target: "127.0.0.1:5000",
    url: "http://127.0.0.1:5000/",
    detail: () => "SERVICE UP",
  },
  {
    id: "daemon",
    name: "CONTROL DAEMON",
    target: "loopback /api",
    url: "/api/health",
    detail: (body) => {
      try {
        const json = JSON.parse(body) as { version?: string; platform?: string };
        return [json.version ? `v${json.version}` : "", json.platform ?? ""].filter(Boolean).join(" · ") || "DAEMON UP";
      } catch {
        return "DAEMON UP";
      }
    },
  },
];

async function probe(def: ProbeDef, budget = 1600): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(def.url, { signal: controller.signal });
    const body = await res.text().catch(() => "");
    return { state: res.ok ? "online" : "offline", detail: res.ok ? def.detail(body) : `HTTP ${res.status}` };
  } catch {
    return { state: "offline", detail: "NO ANSWER ON LOOPBACK" };
  } finally {
    clearTimeout(timer);
  }
}

function Gauge({ state, index }: { state: ProbeState; index: number }) {
  const color = state === "online" ? "#c8ff16" : state === "probing" ? "#7f8a83" : "#3a423d";
  return (
    <svg viewBox="0 0 44 44" className="mesh-gauge" style={{ animationDelay: `${index * 120}ms` }}>
      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(233,237,232,0.1)" strokeWidth="2" />
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={state === "online" ? "85 113" : state === "probing" ? "30 40" : "6 6"}
        strokeLinecap="round"
        className={state === "probing" ? "mesh-gauge__spin" : ""}
        transform="rotate(-90 22 22)"
      />
      <circle cx="22" cy="22" r="4" fill={state === "online" ? "#c8ff16" : "#3a423d"} />
    </svg>
  );
}

export function MeshStatus(_props: MeshNodeProps) {
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [cycle, setCycle] = useState(0);
  const facts = knowledgeState();
  const aliveRef = useRef(true);

  const run = useCallback(() => {
    setCycle((c) => c + 1);
    for (const def of PROBES) {
      setResults((prev) => ({ ...prev, [def.id]: { state: "probing", detail: prev[def.id]?.detail ?? "PROBING…" } }));
    }
    PROBES.forEach(async (def, order) => {
      await new Promise((resolve) => setTimeout(resolve, order * 140));
      if (!aliveRef.current) return;
      const result = await probe(def);
      if (!aliveRef.current) return;
      setResults((prev) => ({ ...prev, [def.id]: result }));
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    run();
    const interval = window.setInterval(run, 12000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(interval);
    };
  }, [run]);

  const online = PROBES.filter((def) => results[def.id]?.state === "online").length;
  const synced = facts.lastSync ? new Date(facts.lastSync).toISOString().slice(0, 16).replace("T", " ") : "NEVER";

  return (
    <div className="mesh-preview">
      <div className="mesh-status__head">
        <span>
          LOOPBACK SWEEP #{cycle} · <b>{online}/{PROBES.length} ANSWERING</b>
        </span>
        <button type="button" className="mesh-mini" onClick={run}>
          RE-PROBE
        </button>
      </div>

      <div className="mesh-status__grid">
        {PROBES.map((def, i) => {
          const result = results[def.id] ?? { state: "probing" as ProbeState, detail: "PROBING…" };
          return (
            <div key={def.id} className="mesh-status__row">
              <Gauge state={result.state} index={i} />
              <div>
                <b>{def.name}</b>
                <span className="mesh-status__target">{def.target}</span>
                <span className={`mesh-status__detail mesh-status__detail--${result.state}`}>
                  {result.state === "online" ? "● " : result.state === "probing" ? "◌ " : "○ "}
                  {result.detail}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mesh-status__memory">
        <div>
          <span>MACHINE MEMORY</span>
          <b>{facts.facts.length} FACTS</b>
        </div>
        <div>
          <span>LAST SYNC (UTC)</span>
          <b>{synced}</b>
        </div>
        <div>
          <span>SYNC CYCLES</span>
          <b>{facts.syncs}</b>
        </div>
      </div>
      <p className="mesh-fine">
        EVERY RESULT IS A REAL SOCKET ANSWER, REFRESHED EVERY 12 SECONDS. NOTHING
        HERE IS SIMULATED — A RED RING MEANS THE PORT IS DARK.
      </p>
    </div>
  );
}
