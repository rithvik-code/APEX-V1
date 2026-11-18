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
  knowledgeContext,
  knowledgeState,
  learnFromGrounding,
  startKnowledgeSync,
  subscribeKnowledge,
  syncKnowledge,
  type KnowledgeState,
} from "../lib/knowledge";
import {
  createRecognizer,
  pttSupported,
  speakRadio,
  stopRadio,
  voxSupported,
  type Recognizer,
} from "../lib/radio";
import { rpmValue, type SceneConfig } from "../lib/scene";
import { currentLicence, type CareerEvent, type CareerState } from "../lib/career";
import { sound } from "../lib/sound";
import { publishPitMemo } from "../lib/pitMemos";
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
  doodle?: { kind: "aero" | "paint" | "grip"; label: string };
  tuneCard?: { label: string; before: string; after: string; beforePct: number; afterPct: number; beforeColor?: string; afterColor?: string; sentence: string };
};

type LinkState = "checking" | "online" | "offline";
type PitPlan = { laps: number; request: string };
type QueuedTurn = { id: string; text: string };

type TerminalProps = {
  onTakeControl?: (goal: string) => void;
  onDrive?: () => void;
  scene: SceneConfig;
  onTune?: (patch: Partial<SceneConfig>) => void;
  career?: CareerState;
  onAward?: (event: CareerEvent) => void;
  onPhoto?: () => void;
  onGarageAction?: (id: string) => void;
  onRaceLine?: (mood: "apex" | "rotation") => void;
};

// Matches an actionable computer task so a handoff is offered even when the
// model is in demo mode or forgets to emit the TAKE_CONTROL tag itself.
const CONTROL_INTENT =
  /\b(take control|control (over |my |the |this )?(laptop|computer|pc|desktop|machine|browser|screen)|on my (laptop|computer|pc|desktop|machine)|open (chrome|edge|firefox|browser|notepad|spotify|a tab|my |the browser)|browse to|navigate to|go to (https?:|www\.)|click (on|the)|type (into|in) |edit (this|the|my|that|another) (website|site|page|file)|change (my|the|this|another) (website|site|page|wallpaper|settings|background)|make (changes|edits|a change) (to|on|in)|fill (out|in|the) |submit (the|this)|download (the|this|from)|search (google|bing|the web|youtube)|launch |run (a|this|the) command|create (a|the) file|delete (the|this) file|rename (the|this)|in my browser|on (this|that|another|the) (website|site|page))\b/i;

function controlIntentGoal(text: string): string | undefined {
  return CONTROL_INTENT.test(text) ? text : undefined;
}

function tuneRecommendation(patch: Partial<SceneConfig>, current: SceneConfig, reply: string): NonNullable<Entry["tuneCard"]> {
  const sentence = (reply.split(/[.!?](?:\s|$)/)[0] || reply).trim().slice(0, 150);
  if (patch.paint) {
    return { label: "LIVERY / FINISH", before: current.paint.base.toUpperCase(), after: patch.paint.base.toUpperCase(), beforePct: 35, afterPct: 82, beforeColor: current.paint.base, afterColor: patch.paint.base, sentence };
  }
  if (patch.rainAmount !== undefined) {
    return { label: "WET TRACK / INTENSITY", before: `${current.weather === "rain" ? Math.round(current.rainAmount * 100) : 0}%`, after: `${patch.weather === "clear" ? 0 : Math.round(patch.rainAmount * 100)}%`, beforePct: current.weather === "rain" ? current.rainAmount * 100 : 0, afterPct: patch.weather === "clear" ? 0 : patch.rainAmount * 100, sentence };
  }
  if (patch.windSpeed !== undefined) {
    return { label: "AERO / FLOW SPEED", before: `${current.windSpeed} KM/H`, after: `${patch.windSpeed} KM/H`, beforePct: ((current.windSpeed - 40) / 360) * 100, afterPct: ((patch.windSpeed - 40) / 360) * 100, sentence };
  }
  if (patch.turbulence !== undefined) {
    return { label: "AIR WAKE / TURBULENCE", before: `${Math.round(current.turbulence * 100)}%`, after: `${Math.round(patch.turbulence * 100)}%`, beforePct: current.turbulence * 100, afterPct: patch.turbulence * 100, sentence };
  }
  if (patch.rpm !== undefined) {
    return { label: "DYNO / TARGET RPM", before: `${rpmValue(current.rpm).toLocaleString()} RPM`, after: `${rpmValue(patch.rpm).toLocaleString()} RPM`, beforePct: current.rpm * 100, afterPct: patch.rpm * 100, sentence };
  }
  const before = current.lighting.toUpperCase();
  const after = (patch.lighting ?? patch.weather ?? patch.livery ?? "SETUP").toString().toUpperCase();
  return { label: "ENGINEER / CONFIGURATION", before, after, beforePct: 42, afterPct: 78, sentence };
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
  ["/photo", "take a garage snapshot and download it as a PNG"],
  ["/vox [on|off]", "speak replies over the racing radio"],
  ["/web [on|off]", "toggle live web grounding"],
  ["/learn", "sync the local knowledge base now"],
  ["/knowledge", "list facts the machine has learned"],
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
    re: /\b(downforce|drag|wet setup|rain mode|night race|dyno|redline|paint it|livery|top speed|wind speed|grid floor|auto-orbit)\b/i,
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
LOCAL KNOWLEDGE also syncs itself every 15 minutes and remembers what
it read, so answers stay current across sessions. /knowledge to inspect.
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

export function Terminal({
  onTakeControl,
  onDrive,
  scene,
  onTune,
  career,
  onAward,
  onPhoto,
  onGarageAction,
  onRaceLine,
}: TerminalProps) {
  const [settings, setSettings] = useState<AiSettings>(() => loadSettings());
  const [draft, setDraft] = useState<AiSettings>(() => loadSettings());
  const [entries, setEntries] = useState<Entry[]>(INITIAL_ENTRIES);
  const [pitPlan, setPitPlan] = useState<PitPlan | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [crewQueue, setCrewQueue] = useState<QueuedTurn[]>([]);
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
  const [knowledge, setKnowledge] = useState<KnowledgeState>(() =>
    knowledgeState(),
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const voxRef = useRef(false);
  const crewQueueRef = useRef<QueuedTurn[]>([]);
  const recognizerRef = useRef<Recognizer | null>(null);
  const sendRef = useRef<(value: string) => void>(() => {});
  const chips = useMemo(() => buildChips(entries), [entries]);
  const memoryThreads = useMemo(() => entries.flatMap((entry, index) => {
    if (entry.role !== "user" || !entries.slice(index + 1).some((next) => next.role === "assistant")) return [];
    return [{ id: entry.id, label: entry.content.replace(/\s+/g, " ").trim().slice(0, 38) }];
  }).slice(-5).reverse(), [entries]);

  const reopenMemoryThread = useCallback((id: string) => {
    const node = bodyRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.remove("is-memory-rewind");
    window.requestAnimationFrame(() => node.classList.add("is-memory-rewind"));
    window.setTimeout(() => node.classList.remove("is-memory-rewind"), 1500);
  }, []);

  useEffect(() => {
    voxRef.current = vox;
    if (!vox) stopRadio();
  }, [vox]);

  const addEntry = useCallback((role: Entry["role"], content: string) => {
    setEntries((prev) => [...prev, { id: uid(), role, content }]);
  }, []);

  const enqueueTurn = (text: string) => {
    if (crewQueueRef.current.length >= 6) {
      addEntry("meta", "CREW QUEUE FULL · finish or remove a queued request first.");
      return;
    }
    const next = [...crewQueueRef.current, { id: uid(), text }];
    crewQueueRef.current = next;
    setCrewQueue(next);
  };

  const prioritizeTurn = (id: string) => {
    const next = [...crewQueueRef.current];
    const index = next.findIndex((item) => item.id === id);
    if (index > 0) next.unshift(...next.splice(index, 1));
    crewQueueRef.current = next;
    setCrewQueue(next);
  };

  const removeQueuedTurn = (id: string) => {
    const next = crewQueueRef.current.filter((item) => item.id !== id);
    crewQueueRef.current = next;
    setCrewQueue(next);
  };

  const drainCrewQueue = () => {
    if (!mounted.current) return;
    const [next, ...rest] = crewQueueRef.current;
    if (!next) return;
    crewQueueRef.current = rest;
    setCrewQueue(rest);
    window.setTimeout(() => sendRef.current(next.text), 120);
  };

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
            if (prev.provider === "openai" || prev.provider === "hermes") return prev;
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
    if (stored.provider === "hermes") {
      const controller = new AbortController();
      const endpoint = stored.endpoint.replace(/\/+$/, "");
      void fetch(`${endpoint}/models`, {
        headers: stored.apiKey ? { Authorization: `Bearer ${stored.apiKey}` } : {},
        signal: controller.signal,
      }).then((response) => {
        if (mounted.current) setLink(response.ok ? "online" : "offline");
      }).catch(() => {
        if (mounted.current) setLink("offline");
      });
      return () => {
        mounted.current = false;
        controller.abort();
      };
    }
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
          if (prev.provider === "openai" || prev.provider === "hermes") return prev;
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

  // The knowledge base refreshes itself on a timer and on reconnect; the
  // subscription keeps the status bar honest about how much it has learned.
  useEffect(() => {
    startKnowledgeSync();
    setKnowledge({ ...knowledgeState() });
    return subscribeKnowledge(() => setKnowledge({ ...knowledgeState() }));
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

  const handleXp = useCallback(
    (kind: XpKind) => {
      setArcadeStats((prev) => awardArcade(kind, prev));
      if (kind === "quiz-correct") {
        onAward?.({ kind: "quiz", id: "quiz" });
      } else if (kind === "mission") {
        onAward?.({ kind: "mission", id: `arcade-${Date.now().toString(36)}` });
      }
    },
    [onAward],
  );

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
        const tuneCard = tuneRecommendation(action.patch, scene, action.reply);
        setEntries((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: action.reply, engineer: true, tuneCard },
        ]);
        if (voxRef.current) speakRadio(tuneCard.sentence);
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
      case "/learn": {
        addEntry("meta", "KNOWLEDGE // SYNCING LIVE SOURCES...");
        void syncKnowledge(true).then((next) => {
          if (!mounted.current) return;
          const when = next.lastSync
            ? new Date(next.lastSync).toLocaleTimeString()
            : "unknown";
          addEntry(
            "meta",
            next.error
              ? `KNOWLEDGE // SYNC FAILED: ${next.error}. ${next.facts.length} FACTS REMAIN STORED.`
              : `KNOWLEDGE // ${next.facts.length} FACTS STORED · LAST SYNC ${when} · SYNC #${next.syncs}.`,
          );
        });
        break;
      }
      case "/knowledge": {
        const base = knowledgeState();
        const when = base.lastSync
          ? new Date(base.lastSync).toISOString().slice(0, 16).replace("T", " ")
          : "never";
        const rows = base.facts
          .slice(0, 8)
          .map(
            (fact) =>
              `  ${fact.source.padEnd(4)} ${fact.title.slice(0, 62)} · ${new Date(
                fact.at,
              )
                .toISOString()
                .slice(0, 10)}`,
          );
        addEntry(
          "assistant",
          `LOCAL KNOWLEDGE // ${base.facts.length} FACTS · ${base.syncs} SYNCS · LAST ${when} UTC\n\n${
            rows.join("\n") || "  nothing learned yet — run /learn"
          }\n\nThe model reads the best-matching facts before every answer. Facts persist in this browser on this machine.`,
        );
        break;
      }
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
          learnFromGrounding(result);
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
      case "/photo":
        if (!onPhoto && !onGarageAction) {
          addEntry("meta", "PHOTO MODE NOT WIRED IN THIS VIEW.");
          break;
        }
        addEntry("meta", "CAPTURING BAY 01 → APEX-GARAGE-<DATE>.PNG.");
        (onPhoto ?? onGarageAction)?.("photo");
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
      } else {
        enqueueTurn(text);
        setInput("");
        sound.tick("click");
      }
      return;
    }
    setInput("");
    if (/\b(tire|tyre)s?\b/i.test(text) && /\b(shorter|shorten|earlier|window|stint)\b/i.test(text)) {
      const requestedLaps = text.match(/\b(\d{1,2})\s*(?:lap|laps)\b/i);
      setPitPlan({ laps: Math.max(3, Math.min(20, Number(requestedLaps?.[1] ?? 8))), request: text });
    }
    setHistory((prev) => [text, ...prev].slice(0, 30));
    setHistoryIndex(-1);
    sound.tick("click");

    if (text.startsWith("/")) {
      handleCommand(text);
      return;
    }

    const lineMood = /\b(more apex|tighter apex|take more apex)\b/i.test(text)
      ? "apex"
      : /\b(less rotation|reduce rotation|calmer rotation)\b/i.test(text)
        ? "rotation"
        : null;
    if (lineMood && onRaceLine) {
      setEntries((prev) => [
        ...prev,
        { id: uid(), role: "user", content: text },
        {
          id: uid(), role: "assistant", engineer: true,
          content: lineMood === "apex"
            ? "RACING LINE → DEEPER APEX. The motes are drawing toward the inside of each corner."
            : "RACING LINE → REDUCED ROTATION. The swarm is smoothing its corner offsets for a calmer line.",
        },
      ]);
      onRaceLine(lineMood);
      sound.whoosh();
      return;
    }

    onAward?.({ kind: "chat", id: "chat" });

    const engineerAction = onTune ? tuneFromText(text, scene) : null;
    if (engineerAction && onTune) {
      const tuneCard = tuneRecommendation(engineerAction.patch, scene, engineerAction.reply);
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
          tuneCard,
          doodle: {
            kind: /paint|livery|colou?r|stripe/i.test(text) ? "paint" : /wet|rain|wind|pressure|downforce|wing|drag/i.test(text) ? "aero" : "grip",
            label: /paint|livery|colou?r|stripe/i.test(text) ? "LIVERY PROFILE" : /wet|rain/i.test(text) ? "WET GRIP PROFILE" : /wind|pressure|downforce|wing|drag/i.test(text) ? "AIRLOAD PROFILE" : "CORNERING SETUP",
          },
        },
      ]);
      if (voxRef.current) speakRadio(tuneCard.sentence);
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
      // Whatever retrieval found is worth keeping for the next session.
      if (result) learnFromGrounding(result);

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

    // Local knowledge rides along on every turn: whatever live sources the
    // question needs, plus facts learned during earlier background syncs.
    const knowledgeText = knowledgeContext(text);

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
      drainCrewQueue();
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
        knowledge: knowledgeText || undefined,
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
      if (settled) publishPitMemo(display);
      if (voxRef.current && settled) speakRadio(display);
      drainCrewQueue();
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
        : settings.provider === "hermes" ? "HERMES AGENT" : "CLOUD";

  const linkLabel =
    link === "checking" ? "SCANNING" : link === "online" ? "LIVE" : settings.provider === "hermes" ? "OFFLINE" : "DEMO";

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
    } else if (draft.provider === "hermes") {
      const endpoint = draft.endpoint.replace(/\/+$/, "");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      void fetch(`${endpoint}/models`, {
        headers: draft.apiKey ? { Authorization: `Bearer ${draft.apiKey}` } : {},
        signal: controller.signal,
      }).then((response) => {
        setLink(response.ok ? "online" : "offline");
        addEntry("meta", response.ok
          ? "HERMES AGENT LINK READY · CHAT, TOOLS AND MEMORY ROUTED THROUGH HERMES"
          : `HERMES IS NOT READY (${response.status}). START ITS LOCAL API SERVER AND CHECK THE API KEY.`);
      }).catch(() => {
        setLink("offline");
        addEntry("meta", "HERMES IS NOT REACHABLE. INSTALL HERMES AGENT, ENABLE ITS API SERVER, THEN RECONNECT.");
      }).finally(() => window.clearTimeout(timeout));
    } else {
      addEntry("meta", `${draft.provider.toUpperCase()} LINK CONFIGURED.`);
    }
  };

  const setProvider = (provider: Provider) => {
    let endpoint = draft.endpoint;
    let model = draft.model;
    if (provider === "hermes") {
      endpoint = "/hermes/v1";
      model = "hermes-agent";
    } else if (provider === "openai" && (endpoint.includes("11434") || endpoint.includes("/hermes/"))) {
      endpoint = "https://api.openai.com/v1";
    } else if (provider === "ollama" && (endpoint.includes("openai") || endpoint.includes("/hermes/"))) {
      endpoint = DEFAULT_SETTINGS.endpoint;
      model = DEFAULT_SETTINGS.model;
    }
    setDraft({ ...draft, provider, endpoint, model });
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
      {pitPlan && (
        <aside className="pit-board" aria-label="Holographic race strategy board" aria-live="polite">
          <button className="pit-board__close" type="button" onClick={() => setPitPlan(null)} aria-label="Dismiss pit strategy board">×</button>
          <span className="pit-board__eyebrow">APEX / PIT WALL · STRATEGY SYNC</span>
          <h3>TYRE WINDOW <i>SHORTENED</i></h3>
          <p className="pit-board__request">{pitPlan.request}</p>
          <div className="pit-board__chips" aria-label="Suggested pit plan">
            <span>STINT 01</span><span>BOX · LAP {String(pitPlan.laps).padStart(2, "0")}</span><span>SOFT → MEDIUM</span>
          </div>
          <div className="pit-board__stem" aria-label={`Illustrative stint lap markers through lap ${pitPlan.laps}`}>
            <b>STINT LAP / LEAF</b>
            <span><i>0</i><em>{Array.from({ length: Math.min(4, pitPlan.laps) }, (_, i) => ` ${i + 1}`).join("")}</em></span>
            <span><i>0</i><em>{Array.from({ length: Math.max(0, pitPlan.laps - 4) }, (_, i) => ` ${i + 5}`).join("")}</em></span>
            <small>PROPOSED WINDOW · REVIEW BEFORE APPLYING</small>
          </div>
          <button className="pit-board__drive" type="button" onClick={() => onDrive?.()}>OPEN TIME ATTACK ↗</button>
        </aside>
      )}
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

      {crewQueue.length > 0 && (
        <aside className="term__crew-queue" aria-label="Pending Cyrus questions" aria-live="polite">
          <header><b>CREW QUEUE</b><span>{streaming ? "CYRUS IS ANSWERING" : "NEXT REQUEST READY"} · {crewQueue.length}/6</span></header>
          <div>{crewQueue.map((turn, index) => (
            <article key={turn.id} className={index === 0 ? "is-next" : ""}>
              <button type="button" onClick={() => prioritizeTurn(turn.id)} aria-label={`${index === 0 ? "Next up" : "Answer this first"}: ${turn.text}`} title={index === 0 ? "This is next" : "Move this request to the front of the queue"}>
                <i>{String(index + 1).padStart(2, "0")}</i><span>{turn.text}</span><em>{index === 0 ? "NEXT" : "ANSWER FIRST"}</em>
              </button>
              <button type="button" className="term__queue-remove" onClick={() => removeQueuedTurn(turn.id)} aria-label={`Remove queued request: ${turn.text}`}>×</button>
            </article>
          ))}</div>
        </aside>
      )}

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

        {memoryThreads.length > 0 && (
          <nav className="term__memory-threads" aria-label="Recent conversation memory threads">
            <span>MEMORY THREADS</span>
            {memoryThreads.map((thread) => (
              <button key={thread.id} type="button" onClick={() => reopenMemoryThread(thread.id)} title={`Reopen conversation: ${thread.label}`}>
                <i aria-hidden="true" />{thread.label}
              </button>
            ))}
          </nav>
        )}

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
              data-entry-id={entry.id}
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
                  {entry.doodle && !isStreamingEntry && (
                    <div className={`term__doodle term__doodle--${entry.doodle.kind}`} role="img" aria-label={`${entry.doodle.label} setup schematic. ${shownText}`}>
                      <span>CYRUS / PIT-WALL SKETCH</span>
                      <svg viewBox="0 0 150 42" aria-hidden="true"><path className="term__doodle-car" d="M13 27h17l10-13h42l14 12h32l9 5H13z"/><path className="term__doodle-detail" d={entry.doodle.kind === "aero" ? "M38 12 C55 5 81 6 102 13 M49 8l-7 4 8 3 M91 9l8 4-8 3" : entry.doodle.kind === "paint" ? "M39 19h49 M43 22h38 M46 25h29" : "M36 32v-8m9 8v-8m44 8v-8m9 8v-8 M34 35h66"}/><circle cx="42" cy="31" r="5"/><circle cx="96" cy="31" r="5"/></svg>
                      <b>{entry.doodle.label}</b><small>{entry.doodle.kind === "aero" ? "LOAD / FLOW / DRAG" : entry.doodle.kind === "paint" ? "BASE / ACCENT / STRIPE" : "FRONT / REAR / GRIP"}</small>
                    </div>
                  )}
                  {entry.tuneCard && !isStreamingEntry && (
                    <div className="term__tune-card" aria-label={`${entry.tuneCard.label}. Before ${entry.tuneCard.before}; after ${entry.tuneCard.after}. ${entry.tuneCard.sentence}`}>
                      <div className="term__tune-head"><span>ENGINEER / SETUP DELTA</span><b>{entry.tuneCard.label}</b></div>
                      <div className="term__tune-compare">
                        <div><span>BEFORE <i>{entry.tuneCard.before}</i></span><div className="term__tune-track"><i style={{ width: `${Math.max(2, Math.min(100, entry.tuneCard.beforePct))}%`, backgroundColor: entry.tuneCard.beforeColor }} /></div></div>
                        <div><span>AFTER <i>{entry.tuneCard.after}</i></span><div className="term__tune-track is-after"><i style={{ width: `${Math.max(2, Math.min(100, entry.tuneCard.afterPct))}%`, backgroundColor: entry.tuneCard.afterColor }} /></div></div>
                      </div>
                      <small>RADIO / {entry.tuneCard.sentence}</small>
                    </div>
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
                <span className="term__thinking">ANSWERING</span>
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
                <option value="hermes">HERMES AGENT — local tools + memory</option>
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
              <span>API KEY — CLOUD / HERMES LOCAL</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder="stored in this browser only"
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.target.value })
                }
              />
            </label>
            {draft.provider === "hermes" && <p className="term__field--full">Install Hermes Agent and start its local API server. Then enter its API key here. <a href="https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/" target="_blank" rel="noreferrer">Hermes setup guide ↗</a></p>}
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
          KNOWLEDGE <b>{knowledge.facts.length}</b>
        </span>
        <span>
          {career ? (
            <>
              LICENCE <b>{currentLicence(career.cp).short}</b> · CP <b>{career.cp}</b>
            </>
          ) : (
            <>
              XP <b>{arcadeStats.xp}</b>
            </>
          )}
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
