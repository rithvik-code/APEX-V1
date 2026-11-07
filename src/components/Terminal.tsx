import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  listOllamaModels,
  loadSettings,
  saveSettings,
  streamChat,
  type AiSettings,
  type ChatMessage,
  type Provider,
} from "../lib/ai";
import { sound } from "../lib/sound";

type Entry = {
  id: string;
  role: "user" | "assistant" | "meta";
  content: string;
};

type LinkState = "checking" | "online" | "offline";

const COMMANDS = [
  ["/help", "show local commands"],
  ["/live", "detect a local Ollama model and connect"],
  ["/demo", "drop back to the canned demo"],
  ["/model <name>", "switch the active model"],
  ["/prompt <text>", "replace the system prompt"],
  ["/settings", "open the link configuration"],
  ["/install", "show CLI install steps"],
  ["/clear", "wipe the session"],
  ["/stop", "abort the current stream"],
];

const CHIPS = [
  "Write a retry helper",
  "Design a local RAG stack",
  "Why is my build slow?",
  "How is this free?",
];

const WELCOME = `APEX READY.

Terminal is warm. Type /help for local commands, or ask anything.
The demo link is canned — open LINK to point this terminal at a local
Ollama model and it starts thinking for real.`;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const INITIAL_ENTRIES: Entry[] = [
  { id: "welcome", role: "assistant", content: WELCOME },
];

export function Terminal() {
  const [settings, setSettings] = useState<AiSettings>(() => loadSettings());
  const [draft, setDraft] = useState<AiSettings>(() => loadSettings());
  const [entries, setEntries] = useState<Entry[]>(INITIAL_ENTRIES);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [link, setLink] = useState<LinkState>("checking");
  const [models, setModels] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [notice, setNotice] = useState("");

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const addEntry = useCallback((role: Entry["role"], content: string) => {
    setEntries((prev) => [...prev, { id: uid(), role, content }]);
  }, []);

  const detect = useCallback(
    async (endpoint: string, silent = false): Promise<string[]> => {
      setLink("checking");
      const controller = new AbortController();
      // The first frame can block the main thread while shaders compile, so a
      // startup probe gets a much longer budget than a manual scan.
      const timeout = setTimeout(
        () => controller.abort(),
        silent ? 30000 : 8000,
      );
      try {
        const found = await listOllamaModels(endpoint, controller.signal);
        if (!mounted.current) return [];
        setModels(found);
        setLink(found.length ? "online" : "offline");
        if (found.length && !silent) {
          const preferred =
            found.find((m) => m.includes("qwen2.5:3b")) ?? found[0];
          setSettings((prev) => {
            if (prev.provider === "openai") return prev;
            const next: AiSettings = {
              ...prev,
              provider: "ollama",
              model: prev.model || preferred,
            };
            saveSettings(next);
            return next;
          });
        }
        return found;
      } catch {
        if (!mounted.current) return [];
        setLink("offline");
        return [];
      } finally {
        clearTimeout(timeout);
      }
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    const stored = loadSettings();
    if (stored.provider === "openai") {
      setLink("offline");
      return () => {
        mounted.current = false;
      };
    }

    void detect(stored.endpoint, true).then((found) => {
      if (!mounted.current) return;
      if (found.length) {
        const preferred =
          found.find((m) => m.includes("qwen2.5:3b")) ?? found[0];
        setSettings((prev) => {
          if (prev.provider === "openai") return prev;
          const next: AiSettings = {
            ...prev,
            provider: "ollama",
            model: found.includes(prev.model) ? prev.model : preferred,
          };
          saveSettings(next);
          return next;
        });
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            role: "meta",
            content: `LOCAL LINK ESTABLISHED → ${preferred} · UNMETERED`,
          },
        ]);
      } else {
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            role: "meta",
            content:
              "NO LOCAL MODEL DETECTED. START `ollama serve`, THEN RUN /live — OR OPEN LINK TO CONFIGURE.",
          },
        ]);
      }
    });

    return () => {
      mounted.current = false;
    };
  }, [detect]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [entries, streaming, settingsOpen]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const persist = (next: AiSettings) => {
    setSettings(next);
    saveSettings(next);
    setDraft(next);
  };

  const openSettings = () => {
    setDraft(settings);
    setSettingsOpen(true);
    setNotice("");
    sound.tick("click");
  };

  const handleCommand = (raw: string) => {
    const [command, ...rest] = raw.split(" ");
    const arg = rest.join(" ").trim();
    switch (command.toLowerCase()) {
      case "/help":
        addEntry(
          "assistant",
          `LOCAL COMMANDS\n\n${COMMANDS.map(
            ([cmd, desc]) => `  ${cmd.padEnd(16, " ")} ${desc}`,
          ).join("\n")}\n\nEverything else goes to the model.`,
        );
        break;
      case "/clear":
        setEntries(INITIAL_ENTRIES);
        break;
      case "/live": {
        addEntry("meta", "SCANNING LOCALHOST FOR AN INFERENCE DAEMON...");
        void detect(settings.endpoint).then((found) => {
          if (!found.length) {
            addEntry(
              "meta",
              "NO LOCAL MODEL FOUND. `ollama serve` THEN RETRY, OR OPEN LINK.",
            );
            return;
          }
          const model = found.includes(settings.model)
            ? settings.model
            : (found.find((m) => m.includes("qwen2.5:3b")) ?? found[0]);
          persist({ ...settings, provider: "ollama", model });
          addEntry("meta", `LOCAL LINK LIVE → ${model}`);
        });
        break;
      }
      case "/demo":
        persist({ ...settings, provider: "demo" });
        addEntry("meta", "DEMO LINK ACTIVE. CANNED INTELLIGENCE, REAL INTERFACE.");
        break;
      case "/model":
        if (!arg) {
          addEntry(
            "meta",
            `ACTIVE MODEL: ${settings.model}\nAVAILABLE: ${
              models.length ? models.join(", ") : "none detected"
            }`,
          );
          break;
        }
        persist({ ...settings, model: arg, provider: "ollama" });
        addEntry("meta", `MODEL → ${arg}`);
        break;
      case "/prompt":
        if (!arg) {
          openSettings();
          break;
        }
        persist({ ...settings, systemPrompt: arg });
        addEntry("meta", "SYSTEM PROMPT REPLACED. APPLIES TO THE NEXT TURN.");
        break;
      case "/settings":
        openSettings();
        break;
      case "/install":
        addEntry(
          "assistant",
          `INSTALL APEX\n\n  npm install -g ./cli\n  apex\n\n  # or one-shot\n  apex "summarise this repo"\n\n  # custom persona\n  apex config\n\nRequires Node 18+ and Ollama running locally.`,
        );
        break;
      case "/stop":
        abortRef.current?.abort();
        addEntry("meta", "STREAM ABORTED.");
        break;
      default:
        addEntry("meta", `UNKNOWN COMMAND "${command}". TRY /help.`);
    }
  };

  const send = async (value: string) => {
    const text = value.trim();
    if (!text) return;
    if (streaming) return;
    setInput("");
    setHistory((prev) => [text, ...prev].slice(0, 30));
    setHistoryIndex(-1);
    sound.tick("click");

    if (text.startsWith("/")) {
      handleCommand(text);
      return;
    }

    const userEntry: Entry = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    const historyForModel: ChatMessage[] = [
      ...entries
        .filter((entry) => entry.role !== "meta")
        .map((entry) => ({
          role: entry.role as "user" | "assistant",
          content: entry.content,
        })),
      { role: "user", content: text },
    ];

    setEntries((prev) => [
      ...prev,
      userEntry,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        settings,
        messages: historyForModel,
        signal: controller.signal,
        onToken: (token) => {
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: entry.content + token }
                : entry,
            ),
          );
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message =
          error instanceof Error ? error.message : "Unknown link failure.";
        setEntries((prev) => [
          ...prev.map((entry) =>
            entry.id === assistantId && !entry.content
              ? {
                  ...entry,
                  content: `[LINK FAILED]\n${message}\n\nFalling back is one click: open LINK and switch to DEMO, or start your local model.`,
                }
              : entry,
          ),
        ]);
        setLink("offline");
      }
    } finally {
      if (mounted.current) setStreaming(false);
      abortRef.current = null;
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const next = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(next);
      setInput(history[next]);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.max(-1, historyIndex - 1);
      setHistoryIndex(next);
      setInput(next === -1 ? "" : history[next]);
    }
    if (event.key === "Escape") {
      setSettingsOpen(false);
    }
  };

  const providerLabel =
    settings.provider === "demo"
      ? "DEMO"
      : settings.provider === "ollama"
        ? "LOCAL"
        : "CLOUD";

  const linkLabel =
    link === "checking" ? "SCANNING" : link === "online" ? "LIVE" : "DEMO";

  const applySettings = () => {
    persist(draft);
    setSettingsOpen(false);
    sound.tick("click");
    if (draft.provider === "ollama") {
      void detect(draft.endpoint).then((found) => {
        if (found.length) {
          addEntry(
            "meta",
            `LINK READY → ${found.find((m) => m.includes(draft.model)) ?? found[0]}`,
          );
        }
      });
    } else {
      addEntry("meta", `${draft.provider.toUpperCase()} LINK CONFIGURED.`);
    }
  };

  const setProvider = (provider: Provider) => {
    const endpoint =
      provider === "openai" && draft.endpoint.includes("11434")
        ? "https://api.openai.com/v1"
        : provider === "ollama" && draft.endpoint.includes("openai")
          ? DEFAULT_SETTINGS.endpoint
          : draft.endpoint;
    setDraft({ ...draft, provider, endpoint });
  };

  const copySession = async () => {
    const transcript = entries
      .map((entry) => `${entry.role === "user" ? "YOU" : "APEX"}: ${entry.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(transcript);
      setNotice("SESSION COPIED");
      window.setTimeout(() => setNotice(""), 1600);
    } catch {
      setNotice("CLIPBOARD BLOCKED");
    }
  };

  return (
    <div className="term" id="terminal-widget">
      <div className="term__bar">
        <div className="term__lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="term__path">APEX://PIT-WALL/SESSION-01</span>
        <span className={`term__state term__state--${link}`}>
          <i />
          {linkLabel}
        </span>
        <button
          type="button"
          className="term__textbtn"
          onClick={copySession}
          aria-label="Copy session transcript"
        >
          {notice || "COPY"}
        </button>
        <button
          type="button"
          className="term__linkbtn"
          onClick={openSettings}
          aria-expanded={settingsOpen}
        >
          LINK ↗
        </button>
      </div>

      <div
        className="term__body"
        ref={bodyRef}
        role="region"
        aria-label="Terminal transcript"
      >
        <div className="term__boot">
          <span>APEX KERNEL v1.3.0 / BUILD 2026.11.07</span>
          <span>LOCAL-FIRST INFERENCE ENGINE</span>
          <span>NO KEY · NO METER · NO MIDDLEMAN</span>
          <span>AGENT MODE · TIERS · ROLLBACK</span>
        </div>

        {entries.map((entry) => (
          <div key={entry.id} className={`term__entry term__entry--${entry.role}`}>
            {entry.role === "user" ? (
              <>
                <span className="term__sigil">›</span>
                <p>{entry.content}</p>
              </>
            ) : entry.role === "assistant" ? (
              <>
                <span className="term__tag">APEX</span>
                <p>
                  {entry.content}
                  {streaming &&
                    entry.id === entries[entries.length - 1]?.id && (
                      <span className="term__caret" aria-hidden="true" />
                    )}
                </p>
              </>
            ) : (
              <p className="term__meta">
                <span>//</span> {entry.content}
              </p>
            )}
          </div>
        ))}

        {streaming &&
          entries[entries.length - 1]?.role === "assistant" &&
          entries[entries.length - 1]?.content === "" && (
            <div className="term__entry term__entry--assistant">
              <span className="term__tag">APEX</span>
              <p>
                <span className="term__thinking">THINKING</span>
                <span className="term__caret" aria-hidden="true" />
              </p>
            </div>
          )}
      </div>

      {settingsOpen && (
        <div
          className="term__settings"
          role="group"
          aria-label="Link configuration"
        >
          <div className="term__settings-head">
            <span>LINK CONFIGURATION</span>
            <button
              type="button"
              className="term__textbtn"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close link configuration"
            >
              CLOSE [ESC]
            </button>
          </div>
          <div className="term__fields">
            <label>
              <span>PROVIDER</span>
              <select
                value={draft.provider}
                onChange={(event) => setProvider(event.target.value as Provider)}
              >
                <option value="demo">DEMO — canned</option>
                <option value="ollama">OLLAMA — local / free</option>
                <option value="openai">OPENAI-COMPATIBLE — cloud</option>
              </select>
            </label>
            <label>
              <span>ENDPOINT</span>
              <input
                value={draft.endpoint}
                spellCheck={false}
                onChange={(event) =>
                  setDraft({ ...draft, endpoint: event.target.value })
                }
              />
            </label>
            <label>
              <span>MODEL</span>
              <input
                value={draft.model}
                spellCheck={false}
                list="apex-models"
                onChange={(event) =>
                  setDraft({ ...draft, model: event.target.value })
                }
              />
              <datalist id="apex-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            <label>
              <span>API KEY — CLOUD ONLY</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder="stored in this browser only"
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.target.value })
                }
              />
            </label>
            <label className="term__field--full">
              <span>SYSTEM PROMPT</span>
              <textarea
                rows={5}
                value={draft.systemPrompt}
                onChange={(event) =>
                  setDraft({ ...draft, systemPrompt: event.target.value })
                }
              />
            </label>
          </div>
          <div className="term__settings-foot">
            <p>
              Ollama runs on your machine. No key, no account, no token bill.
              Cloud endpoints are metered by their provider.
            </p>
            <div>
              <button
                type="button"
                className="term__btn term__btn--ghost"
                onClick={() => {
                  setNotice("SCANNING");
                  void detect(draft.endpoint).then((found) => {
                    setNotice(found.length ? `${found.length} FOUND` : "NONE");
                    window.setTimeout(() => setNotice(""), 2000);
                  });
                }}
                aria-label="Scan for local models"
              >
                SCAN
              </button>
              <button
                type="button"
                className="term__btn"
                onClick={applySettings}
              >
                APPLY LINK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="term__chips">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => void send(chip)}
            disabled={streaming}
          >
            {chip}
          </button>
        ))}
      </div>

      <form
        className="term__input"
        onSubmit={onSubmit}
        aria-label="Terminal command"
      >
        <span className="term__prompt">apex@local:~$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={streaming ? "streaming — /stop to abort" : "ask anything, or /help"}
          aria-label="Terminal input"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          RUN ↵
        </button>
      </form>

      <div className="term__status" role="status" aria-live="polite">
        <span>
          PROVIDER <b>{providerLabel}</b>
        </span>
        <span>
          MODEL <b>{settings.model || "UNSET"}</b>
        </span>
        <span>
          SYSTEM <b>NO METER</b>
        </span>
        <span className="term__status-right">
          {streaming ? "STREAM ACTIVE" : "READY"} <i />
        </span>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {notice}
      </span>
    </div>
  );
}
