import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  listOllamaModels,
  pickBestModel,
  streamChat,
} from "../../../lib/ai";

type Column = {
  id: string;
  name: string;
  persona: string;
  text: string;
  busy: boolean;
  error: string;
};

const AGENTS: Array<Omit<Column, "text" | "busy" | "error">> = [
  {
    id: "strategist",
    name: "STRATEGIST",
    persona:
      "You are the STRATEGIST node of a multi-agent convoy. Answer with the big picture: what matters, what wins, what to do next. Maximum 90 words. No preamble.",
  },
  {
    id: "skeptic",
    name: "SKEPTIC",
    persona:
      "You are the SKEPTIC node of a multi-agent convoy. Attack the question's weak points, name the risks and the failure modes, correct overconfidence. Maximum 90 words. No preamble.",
  },
  {
    id: "engineer",
    name: "ENGINEER",
    persona:
      "You are the ENGINEER node of a multi-agent convoy. Give the concrete technical answer: numbers, steps, commands where relevant. Maximum 90 words. No preamble.",
  },
];

const emptyColumns = (): Column[] =>
  AGENTS.map((agent) => ({ ...agent, text: "", busy: false, error: "" }));

export function Convoy(_props: Record<string, never>) {
  const [probe, setProbe] = useState<"cold" | "probing" | "online" | "offline">("cold");
  const [models, setModels] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [columns, setColumns] = useState<Column[]>(emptyColumns);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const modelRef = useRef<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const detect = async () => {
    setProbe("probing");
    try {
      const found = await listOllamaModels("http://127.0.0.1:11434");
      setModels(found);
      modelRef.current = pickBestModel(found);
      setProbe(found.length ? "online" : "offline");
    } catch {
      setModels([]);
      setProbe("offline");
    }
  };

  useEffect(() => {
    void detect();
  }, []);

  const run = async () => {
    const q = question.trim();
    if (!q || running || probe !== "online") return;
    setRunning(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setColumns(emptyColumns);
    await Promise.all(
      AGENTS.map(async (agent, index) => {
        setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, busy: true, error: "" } : col)));
        try {
          await streamChat({
            settings: {
              ...DEFAULT_SETTINGS,
              provider: "ollama",
              endpoint: "http://127.0.0.1:11434",
              model: modelRef.current ?? "",
              systemPrompt: agent.persona,
            },
            messages: [{ role: "user", content: q }],
            onToken: (token) =>
              setColumns((prev) =>
                prev.map((col, i) => (i === index ? { ...col, text: col.text + token } : col)),
              ),
            signal: controller.signal,
            temperature: 0.7,
            numPredict: 220,
          });
        } catch (err) {
          if (!controller.signal.aborted) {
            setColumns((prev) =>
              prev.map((col, i) =>
                i === index
                  ? { ...col, error: err instanceof Error ? err.message.slice(0, 120) : "stream failed" }
                  : col,
              ),
            );
          }
        } finally {
          setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, busy: false } : col)));
        }
      }),
    );
    setRunning(false);
  };

  return (
    <div className="mesh-preview">
      <div className="mesh-convoy__head">
        <span>
          DAEMON{" "}
          <b className={probe === "online" ? "is-on" : probe === "offline" ? "is-off" : ""}>
            {probe === "online"
              ? `ONLINE · ${models.length} MODELS · ${modelRef.current ?? ""}`
              : probe === "probing"
                ? "PROBING 11434…"
                : probe === "offline"
                  ? "NO ANSWER ON 127.0.0.1:11434"
                  : "—"}
          </b>
        </span>
        <button type="button" className="mesh-mini" onClick={() => void detect()}>
          RE-DETECT
        </button>
      </div>

      <div className="mesh-query">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
          }}
          placeholder={probe === "online" ? "put one question to the convoy…" : "the convoy needs a local Ollama daemon"}
          spellCheck={false}
          disabled={probe !== "online"}
        />
        <button type="button" onClick={() => void run()} disabled={probe !== "online" || running}>
          {running ? "…" : "DEPLOY"}
        </button>
      </div>

      <div className="mesh-convoy__cols">
        {columns.map((col) => (
          <div key={col.id} className={`mesh-convoy__col ${col.busy ? "is-busy" : ""}`}>
            <span className="mesh-convoy__name">{col.name}</span>
            <p>{col.text || (col.busy ? "…" : col.error ? `⚠ ${col.error}` : "—")}</p>
          </div>
        ))}
      </div>

      {probe === "offline" && (
        <p className="mesh-fine">
          THE CONVOY REFUSES TO PRETEND. START A LOCAL DAEMON (`ollama serve`, PULL
          ANY CHAT MODEL) AND THIS NODE GOES LIVE — NOTHING IS FAKED IN THE
          MEANTIME.
        </p>
      )}
    </div>
  );
}
