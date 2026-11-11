import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  listOllamaModels,
  loadSettings,
  pickBestModel,
  saveSettings,
  scoreModel,
  streamChat,
  warmModel,
  type AiSettings,
  type ChatMessage,
  type Provider,
} from "../lib/ai";
import {
  needsGrounding,
  retrieveGrounding,
  warmGrounding,
  type Grounding,
} from "../lib/web";
import { tuneFromText } from "../lib/engineer";
import {
  createRecognizer,
  pttSupported,
  speakRadio,
  stopRadio,
  voxSupported,
  type Recognizer,
} from "../lib/radio";
import type { SceneConfig } from "../lib/scene";
import { sound } from "../lib/sound";
import { ArcadeCard } from "./ArcadeCard";
import type { XpKind } from "./ArcadeCard";
import {
  awardArcade,
  buildArcadePayload,
  classifyArcade,
  loadArcadeMode,
  loadArcadeStats,
  QUIZ_INSTRUCTION,
  saveArcadeMode,
  stripQuizLine,
  type ArcadePayload,
  type ArcadeStats,
} from "../lib/arcade";

type Entry = {
  id: string;
  role: "user" | "assistant" | "meta";
  content: string;
  controlGoal?: string;
  engineer?: boolean;
  arcade?: ArcadePayload;
};

type LinkState = "checking" | "online" | "offline";

type TerminalProps = {
  onTakeControl?: (goal: string) => void;
  onDrive?: () => void;
  scene: SceneConfig;
  onTune?: (patch: Partial<SceneConfig>) => void;
};

// Matches an actionable computer task so a handoff is offered even when the
// model is in demo mode or forgets to emit the TAKE_CONTROL tag itself.
const CONTROL_INTENT =
  /\b(take control|control (over |my |the |this )?(laptop|computer|pc|desktop|machine|browser|screen)|on my (laptop|computer|pc|desktop|machine)|open (chrome|edge|firefox|browser|notepad|spotify|a tab|my |the browser)|browse to|navigate to|go to (https?:|www\.)|click (on|the)|type (into|in) |edit (this|the|my|that|another) (website|site|page|file)|change (my|the|this|another) (website|site|page|wallpaper|settings|background)|make (changes|edits|a change) (to|on|in)|fill (out|in|the) |submit (the|this)|download (the|this|from)|search (google|bing|the web|youtube)|launch |run (a|this|the) command|create (a|the) file|delete (the|this) file|rename (the|this)|in my browser|on (this|that|another|the) (website|site|page))\b/i;

function controlIntentGoal(text: string): string | undefined {
  return CONTROL_INTENT.test(text) ? text : undefined;
}

// The model ends actionable replies with `TAKE_CONTROL: <goal>`; lift that out
// of the prose and turn it into a one-click handoff to the control agent.
function splitControlTag(content: string): { text: string; goal: string | null } {
  const re = /^[ \t]*TAKE_CONTROL:[ \t]*([^\n]+)$/im;
  const match = content.match(re);
  if (!match) return { text: content, goal: null };
  const goal = match[1].trim();
  const text = content
    .replace(re, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { text, goal: goal || null };
}

const COMMANDS = [
  ["/help", "show local commands"],
  ["/race <request>", "race engineer tunes the car live"],
  ["/vox [on|off]", "speak replies over the racing radio"],
  ["/web [on|off]", "toggle live web grounding"],
  ["/arcade [on|off]", "wrap replies in quiz, mission and intel cards"],
  ["/search <query>", "pull live sources without the model"],
  ["/live", "detect a local Ollama model and connect"],
  ["/demo", "drop back to the canned demo"],
  ["/model <name>", "switch the active model"],
  ["/prompt <text>", "replace the system prompt"],
  ["/control <goal>", "hand a task to the computer-use agent"],
  ["/drive", "enter time attack on the hard circuit"],
  ["/settings", "open the link configuration"],
  ["/install", "show CLI install steps"],
  ["/clear", "wipe the session"],
  ["/stop", "abort the current stream"],
];

const BASE_CHIPS = [
  "More downforce for the wet",
  "Who is the F1 world champion?",
  "Run the dyno to redline",
  "Design a local RAG stack",
  "Why is my build slow?",
  "What can you do that ChatGPT can't?",
  "Who won the last race?",
];

type Topic = "tune" | "f1" | "code" | "local" | "apex";

const TOPICS: Array<{ topic: Topic; re: RegExp }> = [
  {
    topic: "tune",
    re: /\b(downforce|drag|wet setup|rain mode|night race|dyno|redline|explode|paint it|livery|top speed|wind speed|grid floor|auto-orbit)\b/i,
  },
  {
    topic: "f1",
    re: /\b(f1|formula (?:one|1)|grand prix|race|champion|championship|podium|pole|verstappen|antonelli|hamilton|leclerc|norris|piastri|russell|alonso|sainz|mclaren|ferrari|mercedes|red bull|aston martin)\b/i,
  },
  {
    topic: "code",
    re: /\b(code|function|component|react|typescript|javascript|python|css|html|api|debug|debugging|error|build|test|refactor|sql|regex|algorithm)\b/i,
  },
  {
    topic: "local",
    re: /\b(ollama|local|model|token|inference|gpu|llm|rag|embedding|quant|prompt)\b/i,
  },
  {
    topic: "apex",
    re: /\b(apex|terminal|site|website|yourself|you|your)\b/i,
  },
];

const ENTITY_STOP = new Set([
  "Who", "What", "When", "Where", "Why", "How", "Is", "Are", "Was", "Were",
  "The", "A", "An", "And", "But", "Or", "Tell", "Give", "Explain", "Define",
  "Describe", "Design", "Write", "Draft", "Can", "Could", "Should", "Would",
  "Do", "Does", "Did", "F1", "Formula", "Grand", "Prix", "GP", "AI", "CEO",
  "API", "US", "UK", "EU", "Show", "Make", "Build", "Please", "Let's", "I",
]);

function pickTopic(queries: string[]): Topic | null {
  let best: Topic | null = null;
  let bestScore = 0;
  for (const { topic, re } of TOPICS) {
    let score = 0;
    // Recent messages count for more than older ones.
    queries.forEach((query, index) => {
      if (re.test(query)) score += queries.length - index;
    });
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

function pickEntity(queries: string[]): string | null {
  for (const query of queries) {
    const words = query.match(/\b[A-Z][a-zA-Z0-9'’.-]{1,}\b/g) ?? [];
    for (let i = words.length - 1; i >= 0; i--) {
      if (!ENTITY_STOP.has(words[i])) return words[i];
    }
  }
  return null;
}

function topicChips(topic: Topic | null, entity: string | null): string[] {
  if (topic === "tune") {
    return [
      "Night race, neon lighting",
      "Explode the car and show the engine",
      "Paint it racing red, number 46",
      "Top speed setup for the straights",
      "Rain mode, heavy storm",
      "Reset the setup to stock",
    ];
  }
  if (topic === "f1") {
    return [
      entity
        ? `How many wins does ${entity} have this season?`
        : "Who leads the championship right now?",
      "Who won the last race?",
      entity
        ? `Is ${entity} the real deal, or just the maths?`
        : "Settle it: best driver on the grid, no diplomacy",
      "What does the constructors' table look like?",
    ];
  }
  if (topic === "code") {
    return [
      "Add the tests, keep them short",
      "Make it faster, not cleverer",
      "What edge case did I miss?",
      "Explain that in one paragraph",
    ];
  }
  if (topic === "local") {
    return [
      "Which model should I actually run?",
      "How do I make the first token instant?",
      "Local vs cloud: the honest maths",
      "Smallest model that's still useful?",
    ];
  }
  if (topic === "apex") {
    return [
      "What can you do that ChatGPT can't?",
      "Show me the fastest route to local",
      "What's actually running under the hood?",
      "Why no API key?",
    ];
  }
  if (entity) {
    return [
      `What's the short version on ${entity}?`,
      `Is ${entity} overhyped?`,
      `What changed for ${entity} this year?`,
      `${entity}: the contrarian take`,
    ];
  }
  return BASE_CHIPS;
}

const F1_NAMES = [
  "Antonelli", "Verstappen", "Hamilton", "Russell", "Leclerc", "Norris",
  "Piastri", "Alonso", "Sainz", "Räikkönen", "Raikkonen",
];

function buildChips(entries: Entry[]): string[] {
  const queries = entries
    .filter((entry) => entry.role === "user")
    .slice(-4)
    .reverse()
    .map((entry) => entry.content);

  if (!queries.length) return BASE_CHIPS.slice(0, 4);

  const asked = new Set(
    queries.map((query) => query.toLowerCase().replace(/[?.!]+$/, "").trim()),
  );
  const topic = pickTopic(queries);
  const latestAnswer =
    entries.filter((entry) => entry.role === "assistant").slice(-1)[0]?.content ??
    "";
  const entity =
    pickEntity(queries) ??
    (topic === "f1"
      ? F1_NAMES.find((name) => latestAnswer.includes(name)) ?? null
      : null);
  const candidates = topicChips(topic, entity);
  const chips: string[] = [];
  for (const chip of [...candidates, ...BASE_CHIPS]) {
    const key = chip.toLowerCase().replace(/[?.!]+$/, "").trim();
    if (asked.has(key) || chips.includes(chip)) continue;
    chips.push(chip);
    if (chips.length === 4) break;
  }
  return chips;
}

const WEB_KEY = "apex.web.v1";

const WELCOME = `APEX READY.

Terminal is warm. Type /help for local commands, or ask anything.
RACE ENGINEER on duty: say "more downforce for the wet" and the car
tunes itself live. RADIO is push-to-talk, VOX speaks the replies.
WEB grounding is ON: current facts (F1, people, releases, news) are
pulled live from Wikipedia and racing data before the model answers.
ARCADE MODE is ON: answers arrive as quiz, mission or intel cards —
the full text stays one click away. /arcade off for plain replies.
Open LINK to point this terminal at a local Ollama model.`;

function loadWeb(): boolean {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function resolveModel(found: string[], current: string): string {
  const best = pickBestModel(found);
  if (!best) return current;
  if (!found.includes(current)) return best;
  // Keep a deliberately chosen model unless the installed best is clearly ahead.
  return scoreModel(best) - scoreModel(current) > 4 ? best : current;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const INITIAL_ENTRIES: Entry[] = [
  { id: "welcome", role: "assistant", content: WELCOME },
];

export function Terminal({ onTakeControl, onDrive, scene, onTune }: TerminalProps) {
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
  const [web, setWeb] = useState<boolean>(() => loadWeb());
  const [vox, setVox] = useState(false);
  const [listening, setListening] = useState(false);
  const [arcade, setArcade] = useState<boolean>(() => loadArcadeMode());
  const [arcadeStats, setArcadeStats] = useState<ArcadeStats>(() =>
    loadArcadeStats(),
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const voxRef = useRef(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const sendRef = useRef<(value: string) => void>(() => {});
  const chips = useMemo(() => buildChips(entries), [entries]);

  useEffect(() => {
    voxRef.current = vox;
    if (!vox) stopRadio();
  }, [vox]);

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
          setSettings((prev) => {
            if (prev.provider === "openai") return prev;
            const next: AiSettings = {
              ...prev,
              provider: "ollama",
              model: resolveModel(found, prev.model),
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
        const preferred = resolveModel(found, stored.model);
        void warmModel({ ...stored, provider: "ollama", model: preferred });
        setSettings((prev) => {
          if (prev.provider === "openai") return prev;
          const next: AiSettings = {
            ...prev,
            provider: "ollama",
            model: resolveModel(found, prev.model),
          };
          saveSettings(next);
          return next;
        });
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            role: "meta",
            content: `LOCAL LINK ESTABLISHED → ${preferred} · UNMETERED · WEB ${loadWeb() ? "ON" : "OFF"}`,
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
    // An arcade card can be taller than the scrollport; anchor to its top so
    // the poster and question show first instead of the tail of the text.
    const lastEntry = body.lastElementChild;
    if (lastEntry instanceof HTMLElement && lastEntry.querySelector(".arcade")) {
      const top =
        lastEntry.getBoundingClientRect().top -
        body.getBoundingClientRect().top +
        body.scrollTop -
        4;
      body.scrollTo({ top, behavior: "smooth" });
      return;
    }
    body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [entries, streaming, settingsOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      searchRef.current?.abort();
      stopRadio();
      recognizerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!loadWeb()) return;
    const id = window.setTimeout(() => {
      void warmGrounding();
    }, 800);
    return () => window.clearTimeout(id);
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

  const setWebMode = (next: boolean) => {
    setWeb(next);
    try {
      localStorage.setItem(WEB_KEY, next ? "1" : "0");
    } catch {
      // Private contexts can block storage; the toggle still applies this session.
    }
    addEntry(
      "meta",
      next
        ? "WEB GROUNDING ON — WIKIPEDIA + LIVE F1 DATA ARE FETCHED BEFORE EACH ANSWER."
        : "WEB GROUNDING OFF — ANSWERS COME FROM THE MODEL'S OWN MEMORY.",
    );
  };

  const toggleWeb = () => {
    sound.tick("click");
    setWebMode(!web);
  };

  const setArcadeMode = (next: boolean) => {
    setArcade(next);
    saveArcadeMode(next);
    addEntry(
      "meta",
      next
        ? "ARCADE MODE ON — REPLIES ARRIVE AS QUIZ, MISSION OR INTEL CARDS. THE FULL TEXT IS ONE CLICK AWAY."
        : "ARCADE MODE OFF — PLAIN TERMINAL REPLIES.",
    );
  };

  const toggleArcade = () => {
    sound.tick("click");
    setArcadeMode(!arcade);
  };

  const handleXp = useCallback((kind: XpKind) => {
    setArcadeStats((prev) => awardArcade(kind, prev));
  }, []);

  const setVoxMode = (next: boolean) => {
    setVox(next);
    addEntry(
      "meta",
      next
        ? "VOX ON — REPLIES COME OVER THE RACING RADIO. PUSH RADIO TO TALK BACK."
        : "VOX OFF — RADIO SILENT.",
    );
  };

  const toggleVox = () => {
    sound.tick("click");
    setVoxMode(!vox);
  };

  const togglePtt = () => {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    if (!recognizerRef.current) {
      recognizerRef.current = createRecognizer(
        (text) => sendRef.current(text),
        () => setListening(false),
      );
    }
    if (!recognizerRef.current) return;
    sound.tick("start");
    setListening(true);
    recognizerRef.current.start();
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
      case "/race": {
        if (!arg) {
          addEntry(
            "meta",
            "USAGE: /race <request> — E.G. /race more downforce for the wet",
          );
          break;
        }
        if (!onTune) {
          addEntry("meta", "RACE ENGINEER UNAVAILABLE IN THIS VIEW.");
          break;
        }
        const action = tuneFromText(arg, scene);
        if (!action) {
          addEntry(
            "meta",
            "ENGINEER // NO TUNING CHANGE DETECTED. TRY: MORE DOWNFORCE FOR THE WET.",
          );
          break;
        }
        addEntry("user", arg);
        onTune(action.patch);
        sound.whoosh();
        setEntries((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: action.reply, engineer: true },
        ]);
        if (voxRef.current) speakRadio(action.reply);
        break;
      }
      case "/vox":
        if (arg && !/^(on|off)$/i.test(arg)) {
          addEntry("meta", "USAGE: /vox [on|off]");
          break;
        }
        setVoxMode(arg ? /^on$/i.test(arg) : !vox);
        break;
      case "/web":
        if (arg && !/^(on|off)$/i.test(arg)) {
          addEntry("meta", "USAGE: /web [on|off]");
          break;
        }
        setWebMode(arg ? /^on$/i.test(arg) : !web);
        break;
      case "/arcade":
        if (arg && !/^(on|off)$/i.test(arg)) {
          addEntry("meta", "USAGE: /arcade [on|off]");
          break;
        }
        setArcadeMode(arg ? /^on$/i.test(arg) : !arcade);
        break;
      case "/search": {
        if (!arg) {
          addEntry("meta", "USAGE: /search <query>");
          break;
        }
        addEntry("meta", `WEB // SEARCHING FOR "${arg.slice(0, 90)}"...`);
        searchRef.current?.abort();
        const searchController = new AbortController();
        searchRef.current = searchController;
        void retrieveGrounding(arg, searchController.signal).then((result) => {
          if (!mounted.current || searchController.signal.aborted) return;
          if (!result) {
            addEntry(
              "meta",
              "WEB // NO SOURCES RETURNED. CHECK THE CONNECTION OR TRY A SHORTER QUERY.",
            );
            return;
          }
          addEntry(
            "assistant",
            `LIVE RETRIEVAL // ${result.fetchedAt.slice(0, 10)}\n\n${result.summary}\n\n${result.sourceLine}`,
          );
        }).catch(() => {
          if (!mounted.current || searchController.signal.aborted) return;
          addEntry("meta", "WEB // RETRIEVAL FAILED. CHECK THE CONNECTION AND TRY AGAIN.");
        });
        break;
      }
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
          const model = resolveModel(found, settings.model);
          persist({ ...settings, provider: "ollama", model });
          void warmModel({ ...settings, provider: "ollama", model });
          addEntry("meta", `LOCAL LINK LIVE → ${model} · WARMING`);
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
        void warmModel({ ...settings, model: arg, provider: "ollama" });
        addEntry("meta", `MODEL → ${arg} · WARMING`);
        if (/qwen3|deepseek-r1/i.test(arg)) {
          addEntry(
            "meta",
            "NOTE: REASONING MODELS MAY STREAM THEIR THOUGHT TRACE INTO THIS TRANSCRIPT. qwen2.5:7b IS THE RECOMMENDED CHAT MODEL.",
          );
        }
        break;
      case "/prompt":
        if (!arg) {
          openSettings();
          break;
        }
        persist({ ...settings, systemPrompt: arg });
        addEntry("meta", "SYSTEM PROMPT REPLACED. APPLIES TO THE NEXT TURN.");
        break;
      case "/control":
        if (!arg) {
          addEntry(
            "meta",
            "USAGE: /control <goal> — HANDS THE TASK TO TAKE CONTROL, THE COMPUTER-USE AGENT.",
          );
          break;
        }
        if (!onTakeControl) {
          addEntry("meta", "CONTROL AGENT UNAVAILABLE IN THIS VIEW.");
          break;
        }
        addEntry("meta", `HANDING OFF TO TAKE CONTROL → "${arg.slice(0, 90)}"`);
        sound.tick("start");
        onTakeControl(arg);
        break;
      case "/drive":
        if (!onDrive) {
          addEntry("meta", "TIME ATTACK UNAVAILABLE IN THIS VIEW.");
          break;
        }
        addEntry(
          "meta",
          "LAUNCHING TIME ATTACK → HARD CIRCUIT / TIMED LAPS / SECTOR SPLITS / GHOST.",
        );
        sound.tick("start");
        onDrive();
        break;
      case "/settings":
        openSettings();
        break;
      case "/install":
        addEntry(
          "assistant",
          `INSTALL APEX\n\n  npm install -g ./cli\n  apex\n\n  # or one-shot\n  apex "summarise this repo"\n\n  # custom persona\n  apex config\n\nRequires Node 18+ and Ollama running locally.\n\nBEST FREE MODELS\n  ollama pull qwen2.5:7b   best quality (~4.7 GB)\n  ollama pull qwen2.5:3b   fastest (~1.9 GB)\n  ollama pull gemma3:4b    alternate (~3.3 GB)\n\nAPEX auto-selects the strongest chat model it finds installed.`,
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
    if (streaming) {
      if (text.toLowerCase() === "/stop") {
        setInput("");
        abortRef.current?.abort();
        addEntry("meta", "STREAM ABORTED.");
      }
      return;
    }
    setInput("");
    setHistory((prev) => [text, ...prev].slice(0, 30));
    setHistoryIndex(-1);
    sound.tick("click");

    if (text.startsWith("/")) {
      handleCommand(text);
      return;
    }

    const engineerAction = onTune ? tuneFromText(text, scene) : null;
    if (engineerAction && onTune) {
      setEntries((prev) => [...prev, { id: uid(), role: "user", content: text }]);
      onTune(engineerAction.patch);
      sound.whoosh();
      setEntries((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: engineerAction.reply,
          engineer: true,
        },
      ]);
      if (voxRef.current) speakRadio(engineerAction.reply);
      return;
    }

    const intentGoal = controlIntentGoal(text);
    const arcadeKind = arcade ? classifyArcade(text, Boolean(intentGoal)) : null;
    const userEntry: Entry = { id: uid(), role: "user", content: text };
    const metaId = uid();
    // Only recent turns matter for the answer, and a shorter transcript means
    // a shorter prefill on every request.
    const historyForModel: ChatMessage[] = [
      ...entries
        .filter((entry) => entry.role !== "meta" && entry.id !== "welcome")
        .slice(-6)
        .map((entry) => {
          const clean = entry.content
            .replace(/\n*SOURCES ─[\s\S]*$/, "")
            .replace(/^[ \t]*TAKE_CONTROL:[^\n]*$/gim, "")
            .trim();
          return {
            role: entry.role as "user" | "assistant",
            content: clean.length > 600 ? `${clean.slice(0, 600)}…` : clean,
          };
        }),
      { role: "user", content: text },
    ];

    setEntries((prev) => [...prev, userEntry]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let grounding: Grounding | null = null;
    let failed = false;
    if (web && needsGrounding(text)) {
      setEntries((prev) => [
        ...prev,
        {
          id: metaId,
          role: "meta",
          content: "WEB // RETRIEVING LIVE SOURCES...",
        },
      ]);

      const result = await retrieveGrounding(text, controller.signal);
      grounding = result;

      if (!mounted.current) return;
      if (controller.signal.aborted) {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === metaId
              ? { ...entry, content: "WEB // RETRIEVAL ABORTED." }
              : entry,
          ),
        );
        setStreaming(false);
        abortRef.current = null;
        return;
      }

      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === metaId
            ? {
                ...entry,
                content: result
                  ? `WEB // ${result.sources.length} SOURCES · ${result.fetchedAt.slice(
                      11,
                      16,
                    )}Z · ${result.race ? "LIVE F1 + WIKIPEDIA" : "WIKIPEDIA"}`
                  : "WEB // NO MATCH — ANSWERING FROM LOCAL MEMORY.",
              }
            : entry,
        ),
      );
    }

    const assistantId = uid();
    const quickGrounding = grounding;
    if (quickGrounding?.quick) {
      const quickText = `${quickGrounding.quick}\n\n${quickGrounding.sourceLine}`;
      let quickContent = quickText;
      let quickArcade: ArcadePayload | undefined;
      if (arcadeKind) {
        const built = buildArcadePayload(arcadeKind, quickText, text);
        quickContent = built.text;
        quickArcade = built.payload;
      }
      setEntries((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: quickContent,
          arcade: quickArcade,
        },
      ]);
      setStreaming(false);
      abortRef.current = null;
      if (voxRef.current) speakRadio(quickGrounding.quick);
      return;
    }

    setEntries((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", controlGoal: intentGoal },
    ]);

    // Tokens arrive every few milliseconds; repainting the transcript on each
    // one is the slow part, so paint at most every 45 ms.
    let pending = "";
    let fullText = "";
    let flushTimer: number | null = null;
    const flush = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pending) return;
      const chunk = pending;
      pending = "";
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === assistantId
            ? { ...entry, content: entry.content + chunk }
            : entry,
        ),
      );
    };

    try {
      await streamChat({
        settings,
        messages: historyForModel,
        grounding,
        temperature: grounding ? 0.2 : 0.55,
        extraSystem: arcadeKind === "quiz" ? QUIZ_INSTRUCTION : undefined,
        signal: controller.signal,
        onToken: (token) => {
          pending += token;
          fullText += token;
          if (flushTimer === null) {
            flushTimer = window.setTimeout(flush, 45);
          }
        },
      });
    } catch (error) {
      flush();
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        failed = true;
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
      flush();
      const cited = grounding;
      const settled =
        !failed &&
        mounted.current &&
        !controller.signal.aborted &&
        fullText.trim().length > 0;
      let display = fullText.trimEnd();
      if (settled) {
        if (arcadeKind) {
          // The QUIZ tail line is parsed out here; the prose answer stays
          // available behind the card's FULL ANSWER reveal.
          const withSources = cited ? `${display}\n\n${cited.sourceLine}` : display;
          const built = buildArcadePayload(arcadeKind, withSources, text);
          display = built.text;
          const payload = built.payload;
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: display, arcade: payload }
                : entry,
            ),
          );
        } else {
          if (cited) display = `${display}\n\n${cited.sourceLine}`;
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === assistantId && entry.content.trim()
                ? { ...entry, content: display }
                : entry,
            ),
          );
        }
      }
      if (mounted.current) setStreaming(false);
      abortRef.current = null;
      if (voxRef.current && settled) speakRadio(display);
    }
  };

  useEffect(() => {
    sendRef.current = (value) => void send(value);
  });

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
        if (!found.length) {
          addEntry(
            "meta",
            "LINK SAVED, BUT NO MODEL RESPONDED. START `ollama serve` AND RUN /live.",
          );
          return;
        }
        const model = resolveModel(found, draft.model);
        if (model !== draft.model) {
          const next = { ...draft, model };
          persist(next);
          void warmModel(next);
          addEntry("meta", `LINK READY → ${model} · AUTO-SELECTED BEST INSTALLED`);
        } else {
          void warmModel({ ...draft, provider: "ollama", model });
          addEntry("meta", `LINK READY → ${model} · WARMING`);
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
          className={`term__webbtn${web ? " term__webbtn--on" : ""}`}
          onClick={toggleWeb}
          aria-pressed={web}
          title="Ground answers in live Wikipedia and F1 data"
        >
          WEB {web ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          className={`term__webbtn${arcade ? " term__webbtn--on" : ""}`}
          onClick={toggleArcade}
          aria-pressed={arcade}
          title="Wrap replies in quiz, mission and intel cards"
        >
          ARCADE {arcade ? "ON" : "OFF"}
        </button>
        {pttSupported() && (
          <button
            type="button"
            className={`term__radiobtn${listening ? " term__radiobtn--live" : ""}`}
            onClick={togglePtt}
            aria-pressed={listening}
            title="Push to talk — speak a tuning request to the race engineer"
          >
            <i aria-hidden="true" />
            {listening ? "ON AIR" : "RADIO"}
          </button>
        )}
        {voxSupported() && (
          <button
            type="button"
            className={`term__webbtn${vox ? " term__webbtn--on" : ""}`}
            onClick={toggleVox}
            aria-pressed={vox}
            title="Speak replies over the racing radio"
          >
            VOX {vox ? "ON" : "OFF"}
          </button>
        )}
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
          <span>APEX KERNEL v1.5.0 / BUILD 2026.11.08</span>
          <span>LOCAL-FIRST INFERENCE ENGINE</span>
          <span>NO KEY · NO METER · NO MIDDLEMAN</span>
          <span>WEB GROUNDING · LIVE F1 + WIKIPEDIA</span>
        </div>

        {entries.map((entry) => {
          const isStreamingEntry =
            streaming && entry.id === entries[entries.length - 1]?.id;
          const parsed =
            entry.role === "assistant" ? splitControlTag(entry.content) : null;
          const handoff = parsed
            ? parsed.goal ?? entry.controlGoal ?? null
            : null;
          const shownText = parsed ? stripQuizLine(parsed.text) : entry.content;
          return (
            <div
              key={entry.id}
              className={`term__entry term__entry--${entry.role}${entry.engineer ? " term__entry--engineer" : ""}`}
            >
              {entry.role === "user" ? (
                <>
                  <span className="term__sigil">›</span>
                  <p>{entry.content}</p>
                </>
              ) : entry.role === "assistant" ? (
                <>
                  <span
                    className={`term__tag${entry.engineer ? " term__tag--engineer" : ""}`}
                  >
                    {entry.engineer ? "ENGINEER" : "APEX"}
                  </span>
                  {entry.arcade && !isStreamingEntry ? (
                    <ArcadeCard
                      payload={entry.arcade}
                      text={shownText}
                      stats={arcadeStats}
                      onXp={handleXp}
                      onHandoff={onTakeControl}
                    />
                  ) : (
                    <p>
                      {shownText}
                      {isStreamingEntry && (
                        <span className="term__caret" aria-hidden="true" />
                      )}
                    </p>
                  )}
                  {handoff &&
                    onTakeControl &&
                    !isStreamingEntry &&
                    entry.arcade?.kind !== "mission" && (
                    <button
                      type="button"
                      className="term__handoff"
                      onClick={() => {
                        sound.tick("start");
                        onTakeControl(handoff);
                      }}
                    >
                      <span className="term__handoff-icon" aria-hidden="true">
                        ▶
                      </span>
                      <span className="term__handoff-label">
                        RUN IN TAKE CONTROL
                        <em>
                          {handoff.length > 72
                            ? `${handoff.slice(0, 72)}…`
                            : handoff}
                        </em>
                      </span>
                      <span className="term__handoff-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <p className="term__meta">
                  <span>//</span> {entry.content}
                </p>
              )}
            </div>
          );
        })}

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
          <div className="term__models">
            <span>BEST FREE MODELS</span>
            <code>ollama pull qwen2.5:7b</code>
            <em>best quality · ~4.7 GB</em>
            <code>ollama pull qwen2.5:3b</code>
            <em>fastest · ~1.9 GB</em>
            <code>ollama pull gemma3:4b</code>
            <em>alternate · ~3.3 GB</em>
            <p>
              APEX scores every installed model and auto-selects the strongest
              one that still fits your machine's speed. WEB grounding is
              currently <b>{web ? "ON" : "OFF"}</b> — toggle it in the bar.
            </p>
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
        <span className="term__chips-label" aria-hidden="true">
          NEXT →
        </span>
        {chips.map((chip) => (
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
          WEB <b>{web ? "ON" : "OFF"}</b>
        </span>
        <span>
          XP <b>{arcadeStats.xp}</b>
          {arcadeStats.streak > 0 ? ` · S${arcadeStats.streak}` : ""}
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
