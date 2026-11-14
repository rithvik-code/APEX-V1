import { useCallback, useEffect, useMemo, useState } from "react";
import type { MeshNode } from "../registry";

type ServiceState = "probing" | "online" | "offline" | "unwired";

type Service = {
  url: string | null;
  detail: (body: string) => string;
  steps: string[];
  note: string;
};

const SERVICES: Record<string, Service> = {
  engineer: {
    url: "http://127.0.0.1:11434/api/tags",
    detail: (body) => {
      try {
        const models = (JSON.parse(body) as { models?: Array<{ name?: string }> }).models ?? [];
        return models.length ? `${models.length} MODELS READY` : "DAEMON UP · PULL A MODEL";
      } catch {
        return "DAEMON UP";
      }
    },
    steps: ["ollama pull llama3.1", "ollama serve"],
    note: "Same daemon the terminal and Cyrus already use. Nothing extra to install if you have Ollama.",
  },
  livery: {
    url: "http://127.0.0.1:7860/sdapi/v1/sd-models",
    detail: (body) => {
      try {
        const models = JSON.parse(body) as Array<{ title?: string }>;
        return models.length ? `${models.length} CHECKPOINTS LOADED` : "API UP";
      } catch {
        return "API UP";
      }
    },
    steps: ["git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui", "./webui.sh --api --listen --port 7860"],
    note: "The forge only needs the API flag. Weights stay on your disk; renders stay on your screen.",
  },
  rawlink: {
    url: "http://127.0.0.1:8080/health",
    detail: () => "SERVER UP",
    steps: ["build llama.cpp", "llama-server -m brain.gguf --port 8080"],
    note: "One GGUF, one socket, no framework. The mesh routes overflow inference here when it answers.",
  },
  voiceforge: {
    url: "http://127.0.0.1:5000/",
    detail: () => "SERVICE UP",
    steps: ["pip install piper-tts", "python -m piper.http_server -m voice.onnx --port 5000"],
    note: "Gives the radio co-driver a neural voice. The browser falls back to speechSynthesis when absent.",
  },
  restore: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["python -m pip install realesrgan", "python -m realesrgan.inference --port 7861"],
    note: "The bay has no standard port yet. Point any loopback HTTP upscaler at :7861 and it can be wired in.",
  },
  stretch: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["pip install rife-ncnn-vulkan", "python -m rife_server --port 7862"],
    note: "Frame interpolation wants a service around :7862. The clip exporter writes 30 fps today.",
  },
  stems: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["pip install demucs", "python -m demucs.separate --two-stems=vocals track.mp3"],
    note: "Demucs is a batch tool by default. Wrap it in a tiny loopback API on :7863 to light the node.",
  },
};

function portOf(url: string | null): string {
  if (!url) return "NO STANDARD PORT";
  try {
    return `127.0.0.1:${new URL(url).port || "80"}`;
  } catch {
    return "LOOPBACK";
  }
}

export function Standby({ node }: { node: MeshNode }) {
  const service = SERVICES[node.id] ?? null;
  const [state, setState] = useState<ServiceState>(service?.url ? "probing" : "unwired");
  const [detail, setDetail] = useState(service?.url ? "PROBING…" : "AWAITING WIRING");
  const [checkedAt, setCheckedAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  const target = portOf(service?.url ?? null);
  const setup = useMemo(() => (service ? service.steps.join("\n") : ""), [service]);

  useEffect(() => {
    if (!service?.url) {
      setState("unwired");
      setDetail("AWAITING WIRING");
      return;
    }
    const url = service.url;
    let alive = true;
    let misses = 0;
    let online = false;

    const probe = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        const body = await res.text().catch(() => "");
        if (!alive) return;
        if (res.ok) {
          misses = 0;
          online = true;
          setState("online");
          setDetail(service.detail(body));
        } else {
          setState("offline");
          setDetail(`HTTP ${res.status}`);
        }
      } catch {
        if (!alive) return;
        // A busy tab can stall one fetch; only go dark after two straight misses.
        misses += 1;
        if (online && misses < 2) return;
        online = false;
        setState("offline");
        setDetail("NO ANSWER ON LOOPBACK");
      } finally {
        clearTimeout(timer);
        if (alive) {
          setCheckedAt(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          );
        }
      }
    };

    void probe();
    const interval = window.setInterval(probe, 12000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [service, tick]);

  const copySetup = useCallback(async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [setup]);

  return (
    <div className={`mesh-preview mesh-preview--standby${state === "online" ? " is-live" : ""}`}>
      <div className="mesh-standby__sigil" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="mesh-status__head">
        <span>
          NODE STATE <b className={state === "online" ? "is-on" : ""}>{detail}</b>
        </span>
        <span className="mesh-status__target">{node.runtime}</span>
      </div>

      <div className="mesh-doctor">
        <div>
          <span>TARGET</span>
          <b>{target}</b>
        </div>
        <div>
          <span>LAST PROBE</span>
          <b>{checkedAt || "—"}</b>
        </div>
        <div>
          <span>STATE</span>
          <b className={state === "online" ? "is-on" : ""}>{state.toUpperCase()}</b>
        </div>
      </div>

      <p className="mesh-standby__copy">{node.blurb}</p>

      {service && (
        <div className="mesh-standby__steps">
          <b>{state === "online" ? "RUNNING NOW" : "WAKE IT WITH"}</b>
          {service.steps.map((step) => (
            <code key={step}>{step}</code>
          ))}
          <div className="mesh-doctor__actions">
            <button type="button" className="mesh-mini" onClick={copySetup}>
              {copied ? "COPIED" : "COPY SETUP"}
            </button>
            {service.url && (
              <button type="button" className="mesh-mini" onClick={() => setTick((value) => value + 1)}>
                RE-PROBE
              </button>
            )}
          </div>
        </div>
      )}

      {service && <p className="mesh-fine">{service.note}</p>}
      <p className="mesh-fine">
        {state === "online"
          ? "SERVICE ANSWERED ON LOOPBACK — THIS NODE IS LIVE. RE-PROBED EVERY 12 SECONDS."
          : state === "unwired"
            ? "THIS BAY HAS NO STANDARD PORT. THE MESH WILL NOT PRETEND OTHERWISE."
            : "THIS NODE RUNS NOTHING UNTIL ITS SERVICE EXISTS. THE MESH DOES NOT INSTALL SOFTWARE WITHOUT YOU — WHEN THE PORT ANSWERS, THE NODE GOES LIVE ON ITS OWN."}
      </p>
    </div>
  );
}
