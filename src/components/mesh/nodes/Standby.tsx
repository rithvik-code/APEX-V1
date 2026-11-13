import { useEffect, useState } from "react";
import type { MeshNode } from "../registry";

type ServiceState = "probing" | "online" | "offline" | "unwired";

type Service = {
  url: string | null;
  detail: (body: string) => string;
  steps: string[];
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
    steps: ["git clone stable-diffusion-webui", "./webui.sh --api"],
  },
  rawlink: {
    url: "http://127.0.0.1:8080/health",
    detail: () => "SERVER UP",
    steps: ["brew/cmake build llama.cpp", "llama-server -m brain.gguf --port 8080"],
  },
  voiceforge: {
    url: "http://127.0.0.1:5000/",
    detail: () => "SERVICE UP",
    steps: ["pip install piper-tts", "python -m piper.http_http_server -m voice.onnx --port 5000"],
  },
  restore: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["any Real-ESRGAN service on loopback", "wire it through the control daemon"],
  },
  stretch: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["any RIFE interpolation service on loopback", "wire it through the control daemon"],
  },
  stems: {
    url: null,
    detail: () => "NO STANDARD PORT",
    steps: ["python -m demucs.separate --two-stems=vocals track.mp3", "or host demucs behind a small loopback API"],
  },
};

export function Standby({ node }: { node: MeshNode }) {
  const service = SERVICES[node.id] ?? null;
  const [state, setState] = useState<ServiceState>(service?.url ? "probing" : "unwired");
  const [detail, setDetail] = useState(service?.url ? "PROBING…" : "AWAITING WIRING");

  useEffect(() => {
    if (!service?.url) return;
    let alive = true;
    const probe = async () => {
      setState((prev) => (prev === "probing" ? prev : "probing"));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(service.url, { signal: controller.signal });
        const body = await res.text().catch(() => "");
        if (!alive) return;
        if (res.ok) {
          setState("online");
          setDetail(service.detail(body));
        } else {
          setState("offline");
          setDetail(`HTTP ${res.status}`);
        }
      } catch {
        if (!alive) return;
        setState("offline");
        setDetail("NO ANSWER ON LOOPBACK");
      } finally {
        clearTimeout(timer);
      }
    };
    void probe();
    const interval = window.setInterval(probe, 12000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [service]);

  return (
    <div className="mesh-preview mesh-preview--standby">
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
      <p className="mesh-standby__copy">{node.blurb}</p>
      {service && (
        <div className="mesh-standby__steps">
          <b>WAKE IT WITH</b>
          {service.steps.map((step) => (
            <code key={step}>{step}</code>
          ))}
        </div>
      )}
      <p className="mesh-fine">
        THIS NODE RUNS NOTHING UNTIL ITS SERVICE EXISTS. THE MESH DOES NOT
        INSTALL SOFTWARE WITHOUT YOU — WHEN THE PORT ANSWERS, THE NODE GOES LIVE
        ON ITS OWN.
      </p>
    </div>
  );
}
