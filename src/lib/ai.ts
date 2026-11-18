import { formatGroundingContext, type Grounding } from "./web";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type Provider = "demo" | "ollama" | "openai" | "hermes";

export type AiSettings = {
  provider: Provider;
  endpoint: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
};

export const DEFAULT_SYSTEM_PROMPT = `You are APEX, a terminal-native intelligence engine.
You are direct, technical and fast. No corporate hedging. No repeated disclaimers. No filler.
Answer the question first, then stop. Use plain terminal-friendly text.
Default to short answers. Dry wit is welcome; padding is not.
When code is required, write complete working code.
Never invent a fact, name, date or score. If you are unsure, say so in one line.
You are running on the user's own machine with no metering and no middleman.
You can also act on this machine through APEX CONTROL (the TAKE CONTROL agent): mouse, keyboard, apps, browser tabs, files and terminal. Never claim you cannot access the user's computer.`;

// Appended to every turn so the chatbot knows it can hand computer tasks to the
// native control agent instead of refusing them.
const CONTROL_RULE = `COMPUTER USE: You are not limited to chat. APEX CONTROL ("TAKE CONTROL") is a computer-use agent running on this same Windows laptop. It can move the mouse, click, type, launch and focus apps, drive browser tabs (open, navigate, click, type, and run page JavaScript to read or edit ANY website), read and write files, and run terminal commands. The user approves high-risk steps live.
When the user asks you to DO something on their computer, browser, a website, an app, or their files — open, click, edit, change, fill, search, download, run, create, delete, navigate — NEVER reply that you cannot access their device or that you are "just a language model". You can, through TAKE CONTROL. Confirm the plan in one or two sentences, then end your reply with a line exactly in this format:
TAKE_CONTROL: <one clear sentence stating the goal for the agent>
The interface turns that line into a one-click handoff that performs the task. Add the TAKE_CONTROL line only for actionable computer tasks, never for plain questions or explanations.`;

const FINAL_ONLY_RULE = `FINAL ANSWER ONLY: Do not reveal or print private reasoning, chain-of-thought, analysis, or draft text. Respond with the direct answer only. Keep it concise unless the user asks for detail.`;

// Appended to every turn so the delivery stays fast and dry even when the
// user's saved system prompt predates this rule.
const STYLE_RULE = `STYLE: a race engineer who has seen everything — understated, precise, occasionally wry. Give only the user-facing answer: never reveal, narrate, or print private reasoning, chain-of-thought, analysis, or draft thoughts. Lead with the answer, keep it concise, and include steps or detail only when the user asks for them. At most one short witty line per answer, and only when it fits; facts come first, always. No jokes about errors, bugs or anything the user is struggling with. No emoji. Answer simple questions in under 60 words; use a code block when code is the answer. Never pad to look thorough.`;

const CREATOR_RULE = `PROJECT IDENTITY: APEX and CYRUS were made by K Rithvik. If asked who made, built, or created this app or assistant, answer: "K Rithvik made it."`;

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "demo",
  endpoint: "http://127.0.0.1:11434",
  model: "qwen2.5:7b",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  apiKey: "",
};

const STORAGE_KEY = "apex.settings.v1";

const PROVIDERS: ReadonlySet<Provider> = new Set<Provider>(["demo", "ollama", "openai", "hermes"]);

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    const value =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    // Settings are rendered straight into inputs; an object where a string is
    // expected would break the form before the user can fix it.
    return {
      provider: PROVIDERS.has(value.provider as Provider)
        ? (value.provider as Provider)
        : DEFAULT_SETTINGS.provider,
      endpoint:
        typeof value.endpoint === "string" ? value.endpoint : DEFAULT_SETTINGS.endpoint,
      model: typeof value.model === "string" ? value.model : DEFAULT_SETTINGS.model,
      systemPrompt:
        typeof value.systemPrompt === "string"
          ? value.systemPrompt
          : DEFAULT_SETTINGS.systemPrompt,
      apiKey: typeof value.apiKey === "string" ? value.apiKey : DEFAULT_SETTINGS.apiKey,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private contexts; the session still works.
  }
}

function trimEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export async function listOllamaModels(
  endpoint: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${trimEndpoint(endpoint)}/api/tags`, { signal });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}

// Loads the model into memory and holds it there, so the first real question
// is not paying the multi-second cold-start bill.
export async function warmModel(
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<void> {
  if (settings.provider !== "ollama" || !settings.model) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forward, { once: true });

  try {
    await fetch(`${trimEndpoint(settings.endpoint)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        prompt: "",
        stream: false,
        keep_alive: "30m",
        options: { num_predict: 1 },
      }),
    });
  } catch {
    // Warm-up is an optimisation. If it fails the first turn is merely cold.
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

// Higher is better. Favours modern general-purpose chat models in the 4–9B
// sweet spot: accurate enough to trust, small enough to stream fast.
type BenchEntry = { tps?: number; ttftMs?: number; memMB?: number | null };

function readStoredBench(): Record<string, BenchEntry> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem("apex.bench");
    return raw ? (JSON.parse(raw) as Record<string, BenchEntry>) : {};
  } catch {
    return {};
  }
}

let benchScores: Record<string, BenchEntry> = readStoredBench();

/** Store real measurements so the picker stops ranking models by name alone. */
export function applyBenchScores(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const clean: Record<string, BenchEntry> = {};
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    const entry = value as BenchEntry;
    if (!entry || typeof entry !== "object") continue;
    clean[name] = {
      tps: typeof entry.tps === "number" ? entry.tps : undefined,
      ttftMs: typeof entry.ttftMs === "number" ? entry.ttftMs : undefined,
      memMB: typeof entry.memMB === "number" ? entry.memMB : null,
    };
  }
  benchScores = clean;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("apex.bench", JSON.stringify(clean));
    }
  } catch {
    // Private mode: keep the in-memory copy for this session.
  }
}

/** Pull the CLI's benchmark file through the control daemon, when it is up. */
export async function loadBenchScores(): Promise<void> {
  try {
    const res = await fetch("/api/bench");
    if (!res.ok) return;
    applyBenchScores(((await res.json()) as { models?: unknown }).models);
  } catch {
    // No daemon: the stored measurements still apply.
  }
}

export function scoreModel(name: string): number {
  const n = name.toLowerCase();
  if (/embed|rerank|bge|nomic|minilm|clip|whisper|tts/.test(n)) return -100;

  let score = 6;
  // Reasoning-first models (qwen3, deepseek-r1) stream their chain-of-thought
  // into the transcript on current Ollama builds, so they lose to chat models.
  if (n.includes("qwen3")) score = /instruct|2507/.test(n) ? 30 : 16;
  else if (n.includes("deepseek-r1")) score = 12;
  else if (n.includes("qwen2.5")) score = 25;
  else if (n.includes("gemma3")) score = 24;
  else if (n.includes("llama3.3")) score = 24;
  else if (n.includes("llama3.1")) score = 22;
  else if (/mistral|magistral/.test(n)) score = 21;
  else if (n.includes("phi4")) score = 20;
  else if (n.includes("llama3.2")) score = 15;
  else if (n.includes("qwen")) score = 12;

  const size = n.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  const params = size ? parseFloat(size[1]) : 0;
  if (params) {
    if (params <= 1.5) score -= 4;
    else if (params <= 2.5) score += 2;
    else if (params <= 4.5) score += 12;
    else if (params <= 9) score += 18;
    else if (params <= 12) score += 15;
    else if (params <= 16) score += 10;
    else if (params <= 24) score += 3;
    else score -= 5;
  }

  if (/vl|vision/.test(n)) score -= 5;
  if (/coder|code/.test(n)) score -= 2;

  const measured = benchScores[name] ?? benchScores[n];
  if (measured) {
    if (typeof measured.tps === "number" && measured.tps > 0) score += Math.min(24, measured.tps * 1.2);
    if (typeof measured.ttftMs === "number" && measured.ttftMs > 0) score -= Math.min(12, measured.ttftMs / 400);
    if (typeof measured.memMB === "number" && measured.memMB > 6000) score -= 4;
  }
  return score;
}

export function pickBestModel(models: string[]): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const model of models) {
    const score = scoreModel(model);
    if (score > bestScore) {
      best = model;
      bestScore = score;
    }
  }
  return best;
}

type StreamOptions = {
  settings: AiSettings;
  messages: ChatMessage[];
  onToken: (token: string) => void;
  signal: AbortSignal;
  grounding?: Grounding | null;
  knowledge?: string;
  extraSystem?: string;
  systemPrompt?: string;
  temperature?: number;
  numPredict?: number;
  numCtx?: number;
};

function composeSystem(settings: AiSettings, options: StreamOptions): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [
    options.systemPrompt?.trim() ?? [settings.systemPrompt.trim(), CREATOR_RULE, STYLE_RULE, CONTROL_RULE].join("\n\n"),
    FINAL_ONLY_RULE,
    `SESSION DATE: ${today}. Your training data may be older than this date. For anything that could have changed — champions, standings, releases, prices, news — trust live context when it is provided. When no context covers it and you are unsure, say so instead of guessing.`,
  ];
  if (options.grounding) parts.push(formatGroundingContext(options.grounding));
  if (options.knowledge) parts.push(options.knowledge);
  if (options.extraSystem) parts.push(options.extraSystem);
  return parts.join("\n\n");
}

/** Suppress model-emitted reasoning blocks even if the selected model ignores its thinking switch. */
function createFinalAnswerFilter(onToken: (token: string) => void) {
  let pending = "";
  let hidden = false;
  const openTag = "<think>";
  const closeTag = "</think>";
  const drain = (final = false) => {
    let visible = "";
    while (pending) {
      const marker = hidden ? closeTag : openTag;
      const index = pending.toLowerCase().indexOf(marker);
      if (index >= 0) {
        if (!hidden) visible += pending.slice(0, index);
        pending = pending.slice(index + marker.length);
        hidden = !hidden;
        continue;
      }
      if (final) {
        if (!hidden) visible += pending;
        pending = "";
        break;
      }
      let hold = 0;
      const lower = pending.toLowerCase();
      for (let size = Math.min(marker.length - 1, pending.length); size > 0; size--) {
        if (lower.endsWith(marker.slice(0, size))) { hold = size; break; }
      }
      const safeLength = pending.length - hold;
      if (!hidden) visible += pending.slice(0, safeLength);
      pending = pending.slice(safeLength);
      break;
    }
    if (visible) onToken(visible);
  };
  return { push(token: string) { pending += token; drain(); }, finish() { drain(true); } };
}


async function streamOllama(options: StreamOptions): Promise<void> {
  const { settings, messages, onToken, signal, grounding, temperature, numPredict } =
    options;
  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    keep_alive: "30m",
    messages: [
      { role: "system", content: composeSystem(settings, options) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    options: {
      temperature: temperature ?? (grounding ? 0.2 : 0.55),
      top_p: 0.9,
      num_ctx: options.numCtx ?? 4096,
      num_predict: numPredict ?? (grounding ? 200 : 360),
    },
  };
  // Ask supported Ollama models to disable reasoning mode; the output filter
  // below also protects the transcript when a model ignores this option.
  body.think = false;

  const res = await fetch(`${trimEndpoint(settings.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Local model error ${res.status}. ${detail.slice(0, 180)}`.trim(),
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const answerFilter = createFinalAnswerFilter(onToken);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string };
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        if (json.message?.content) answerFilter.push(json.message.content);
      } catch (err) {
        if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
          throw err;
        }
      }
    }
  }
  answerFilter.finish();
}

async function streamOpenAI(options: StreamOptions): Promise<void> {
  const { settings, messages, onToken, signal, grounding, temperature, numPredict } =
    options;
  const base = trimEndpoint(settings.endpoint);
  const url = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      temperature: temperature ?? (grounding ? 0.2 : 0.55),
      max_tokens: numPredict ?? (grounding ? 200 : 360),
      messages: [
        { role: "system", content: composeSystem(settings, options) },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Endpoint error ${res.status}. ${detail.slice(0, 180)}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const answerFilter = createFinalAnswerFilter(onToken);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const clean = line.trim();
      if (!clean.startsWith("data:")) continue;
      const payload = clean.slice(5).trim();
      if (payload === "[DONE]") { answerFilter.finish(); return; }
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = json.choices?.[0]?.delta?.content;
        if (token) answerFilter.push(token);
      } catch {
        // A partial frame; the next chunk completes it.
      }
    }
  }
  answerFilter.finish();
}

export async function streamChat(options: StreamOptions): Promise<void> {
  if (options.settings.provider === "ollama") {
    return streamOllama(options);
  }
  if (options.settings.provider === "openai" || options.settings.provider === "hermes") {
    return streamOpenAI(options);
  }
  return streamDemo(options);
}

const DEMO_ANSWERS: Array<{ match: RegExp; answer: string }> = [
  {
    match: /install|setup|npm|start/i,
    answer: `INSTALLING APEX

  1. You need Node 18+ and Ollama running locally.
  2. From this project:

       npm install -g ./cli
       apex

  3. Pull a model if you don't have one:

       ollama pull qwen2.5:7b     # best quality / ~4.7 GB
       ollama pull qwen2.5:3b     # fastest / ~1.9 GB

  4. Point APEX at it:

       apex --model qwen2.5:7b

No account. No key. No request meter. The only limit is the model
your machine can carry. APEX auto-selects the strongest model you have
installed and switches to a lighter one if you ask for it.`,
  },
  {
    match: /free|price|cost|limit|unlimited|meter/i,
    answer: `THE ECONOMICS

  Cloud inference is metered because someone else owns the GPU.
  APEX runs against a local Ollama daemon on your hardware.

  COST PER TOKEN ........ 0.00
  MONTHLY CEILING ....... none
  REQUEST LOGGING ....... none
  MIDDLEMAN ............. none

  The trade is honest: you bring the machine, you get the ceiling removed.`,
  },
  {
    match: /code|build|function|react|python|script/i,
    answer: `// APEX // SAMPLE OUTPUT

export async function retry<T>(
  task: () => Promise<T>,
  attempts = 3,
  baseDelay = 220,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const jitter = Math.random() * 80;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** i + jitter));
    }
  }
  throw lastError;
}

Direct, dependency-free, done. Ask for the test harness if you want it.`,
  },
  {
    match: /what are you|who are you|about apex|yourself/i,
    answer: `APEX // TERMINAL INTELLIGENCE

  A command-line engine for people who think faster than dashboards.
  Runs against a local model, streams answers into the terminal, and
  keeps your prompts on your disk.

  PERSONA ..... direct, technical, no fluff
  FILTERS ..... none added by APEX
  PROVIDERS ... Ollama / OpenAI-compatible
  CEILING ..... whatever your hardware can hold

  The demo you're typing into is canned. WEB grounding is on by default
  and pulls live Wikipedia + F1 data before the model answers, so even
  the demo stays honest about the current season.`,
  },
  {
    match: /prompt|persona|system/i,
    answer: `PROMPT CONTROL

  The system prompt is yours. It lives in settings on this page and in
  ~/.apex/config.json for the CLI. Edit the persona, the tone, the rules.

  Current default:
  "Direct, technical, fast. No corporate hedging. No filler."

  Nothing in APEX injects refusals or rewrites your prompt. The model's
  own training still applies — that part is not ours to remove.`,
  },
  {
    match: /safety|guardrail|uncensored|restrict/i,
    answer: `ON LIMITS

  APEX adds no moderation layer, no prompt rewriting, no usage meter.
  Your system prompt is passed through untouched.

  What APEX does not do is change the underlying model's training or
  promise that any local model will answer anything. If you need a
  specific behaviour, choose the model and the prompt yourself.

  That is the honest version of "unrestricted".`,
  },
  {
    match: /hello|hey|hi\b|yo\b/i,
    answer: `APEX ONLINE.

  Terminal is warm, which is more than most cloud status pages manage.
  Ask for code, a system design, a launch plan, or something stranger.
  Type /help for the local command set.`,
  },
];

function demoAnswerFor(input: string): string {
  const match = DEMO_ANSWERS.find((entry) => entry.match.test(input));
  if (match) return match.answer;
  return `APEX // DEMO RESPONSE

  I heard: "${input.slice(0, 120)}"

  This is the static demo — no model is attached to it. The words are
  real, the intelligence is a loop, and the point is the interface.

  To make it live, open LINK (top-right of the terminal) and point APEX
  at your local Ollama daemon. Free, unmetered, and running on your GPU.

  Then ask me again. I promise to be worth the electricity.`;
}

async function streamDemo({
  messages,
  onToken,
  signal,
  grounding,
  knowledge,
}: StreamOptions): Promise<void> {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = grounding
    ? `LIVE RETRIEVAL // ${grounding.fetchedAt.slice(0, 10)}

${grounding.summary}

WEB GROUNDING IS ON — THAT ANSWER CAME FROM LIVE SOURCES, NOT THE CANNED DEMO.`
    : knowledge
      ? `${knowledge.split("\n\n").slice(0, 4).join("\n\n")}

LOCAL KNOWLEDGE IS ON — THAT ANSWER CAME FROM FACTS SYNCED TO THIS MACHINE, NOT THE CANNED DEMO.`
      : demoAnswerFor(last?.content ?? "");
  const chunks = text.match(/.{1,12}/gs) ?? [text];

  for (const chunk of chunks) {
    if (signal.aborted) return;
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 2 + Math.random() * 3));
  }
}
