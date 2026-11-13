import { useEffect, useRef, useState } from "react";

type ModelOption = { id: string; name: string; size: string };

const MODELS: ModelOption[] = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "QWEN 2.5 · 0.5B", size: "~0.5 GB" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "LLAMA 3.2 · 1B", size: "~0.9 GB" },
];

type Phase = "probe" | "ready" | "loading" | "live" | "nogpu" | "error";

export function BrowserBrain(_props: Record<string, never>) {
  const [phase, setPhase] = useState<Phase>("probe");
  const [gpu, setGpu] = useState(false);
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [progress, setProgress] = useState({ text: "", pct: 0 });
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const engineRef = useRef<{ unload?(): Promise<void> } | null>(null);
  const engineAnyRef = useRef<unknown>(null);

  useEffect(() => {
    setGpu(Boolean(navigator.gpu));
    return () => {
      void engineRef.current?.unload?.();
    };
  }, []);

  const load = async () => {
    setError("");
    setProgress({ text: "fetching web-llm runtime…", pct: 0 });
    setPhase("loading");
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (report) => {
          setProgress({ text: report.text.slice(0, 90), pct: Math.round(report.progress * 100) });
        },
      });
      engineAnyRef.current = engine;
      engineRef.current = engine;
      setPhase("live");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "engine load failed");
      setPhase("error");
    }
  };

  const send = async () => {
    const q = input.trim();
    if (!q || streaming || phase !== "live") return;
    setStreaming(true);
    setReply("");
    try {
      const engine = engineAnyRef.current as {
        chat: {
          completions: {
            create(options: unknown): AsyncIterable<{
              choices?: Array<{ delta?: { content?: string } }>;
            }>;
          };
        };
      };
      const chunks = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "You are APEX Browser Brain, a terse local assistant. Answer in under 120 words." },
          { role: "user", content: q },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 300,
      });
      for await (const chunk of chunks) {
        const token = chunk.choices?.[0]?.delta?.content ?? "";
        if (token) setReply((prev) => prev + token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "generation failed");
    } finally {
      setStreaming(false);
    }
  };

  if (!gpu) {
    return (
      <div className="mesh-preview">
        <p className="mesh-error">
          WEBGPU NOT AVAILABLE IN THIS BROWSER. THE BRAIN NEEDS A CHROMIUM-BASED
          BROWSER WITH WEBGPU ENABLED — CHROME 113+ OR EDGE 113+.
        </p>
      </div>
    );
  }

  return (
    <div className="mesh-preview">
      <div className="mesh-status__head">
        <span>
          ENGINE <b>{phase === "live" ? `${modelId.split("-q4")[0]} · WEBGPU` : "WEBGPU READY"}</b>
        </span>
        {phase === "live" ? (
          <span className="mesh-fine">WEIGHTS CACHED — WORKS OFFLINE FROM NOW ON</span>
        ) : (
          <div className="mesh-brain__pick">
            {MODELS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`mesh-mini ${modelId === option.id ? "is-active" : ""}`}
                disabled={phase === "loading"}
                onClick={() => setModelId(option.id)}
              >
                {option.name} · {option.size}
              </button>
            ))}
          </div>
        )}
      </div>

      {phase === "probe" && (
        <button type="button" className="mesh-cta" onClick={() => void load()}>
          DOWNLOAD + LOAD THE BRAIN
        </button>
      )}

      {phase === "loading" && (
        <div className="mesh-build">
          <b>{progress.pct}%</b> · {progress.text}
          <div className="mesh-load__bar mesh-load__bar--wide">
            <i style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {phase === "live" && (
        <>
          <div className="mesh-query">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void send();
              }}
              placeholder="ask the in-tab brain anything…"
              spellCheck={false}
              disabled={streaming}
            />
            <button type="button" onClick={() => void send()} disabled={streaming}>
              {streaming ? "…" : "SEND"}
            </button>
          </div>
          <div className={`mesh-brain__out ${streaming ? "is-streaming" : ""}`}>
            {reply || (streaming ? "▌" : "REPLY APPEARS HERE — TOKEN BY TOKEN, FROM YOUR GPU.")}
          </div>
        </>
      )}

      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
