import { formatGroundingContext, type Grounding } from "./web";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type Provider = "demo" | "ollama" | "openai";

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

// Appended to every turn so the delivery stays fast and dry even when the
// user's saved system prompt predates this rule.
const STYLE_RULE = `STYLE: a race engineer who has seen everything — understated, precise, occasionally wry. At most one short witty line per answer, and only when it fits; facts come first, always. No jokes about errors, bugs or anything the user is struggling with. No emoji. Answer simple questions in under 60 words; use a code block when code is the answer. Never pad to look thorough.`;

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "demo",
  endpoint: "http://127.0.0.1:11434",
  model: "qwen2.5:7b",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  apiKey: "",
};

const STORAGE_KEY = "apex.settings.v1";

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  extraSystem?: string;
  temperature?: number;
  numPredict?: number;
};

function composeSystem(settings: AiSettings, options: StreamOptions): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [
    settings.systemPrompt.trim(),
    `SESSION DATE: ${today}. Your training data may be older than this date. For anything that could have changed — champions, standings, releases, prices, news — trust live context when it is provided. When no context covers it and you are unsure, say so instead of guessing.`,
    STYLE_RULE,
    CONTROL_RULE,
  ];
  if (options.grounding) parts.push(formatGroundingContext(options.grounding));
  if (options.extraSystem) parts.push(options.extraSystem);
  return parts.join("\n\n");
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
      num_ctx: 4096,
      num_predict: numPredict ?? (grounding ? 200 : 360),
    },
  };
  // Qwen3 supports a thinking switch; skipping it removes a long cold-start delay
  // on the smaller quantisations without hurting factual accuracy.
  if (/^qwen3/i.test(settings.model)) body.think = false;

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
        if (json.message?.content) onToken(json.message.content);
      } catch (err) {
        if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
          throw err;
        }
      }
    }
  }
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
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = json.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch {
        // A partial frame; the next chunk completes it.
      }
    }
  }
}

export async function streamChat(options: StreamOptions): Promise<void> {
  if (options.settings.provider === "ollama") {
    return streamOllama(options);
  }
  if (options.settings.provider === "openai") {
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
}: StreamOptions): Promise<void> {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = grounding
    ? `LIVE RETRIEVAL // ${grounding.fetchedAt.slice(0, 10)}

${grounding.summary}

WEB GROUNDING IS ON — THAT ANSWER CAME FROM LIVE SOURCES, NOT THE CANNED DEMO.`
    : demoAnswerFor(last?.content ?? "");
  const chunks = text.match(/.{1,12}/gs) ?? [text];

  for (const chunk of chunks) {
    if (signal.aborted) return;
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 2 + Math.random() * 3));
  }
}
