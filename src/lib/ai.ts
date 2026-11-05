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
When code is required, write complete working code.
You are running on the user's own machine with no metering and no middleman.`;

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "demo",
  endpoint: "http://127.0.0.1:11434",
  model: "qwen2.5:3b",
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

type StreamOptions = {
  settings: AiSettings;
  messages: ChatMessage[];
  onToken: (token: string) => void;
  signal: AbortSignal;
};

async function streamOllama({
  settings,
  messages,
  onToken,
  signal,
}: StreamOptions): Promise<void> {
  const res = await fetch(`${trimEndpoint(settings.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      messages: [
        { role: "system", content: settings.systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      options: { temperature: 0.85, num_ctx: 8192 },
    }),
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

async function streamOpenAI({
  settings,
  messages,
  onToken,
  signal,
}: StreamOptions): Promise<void> {
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
      messages: [
        { role: "system", content: settings.systemPrompt },
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

       ollama pull qwen2.5:3b

  4. Point APEX at it:

       apex --model qwen2.5:3b

No account. No key. No request meter. The only limit is the model
your machine can carry.`,
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
    match: /who|what are you|apex|yourself/i,
    answer: `APEX // TERMINAL INTELLIGENCE

  A command-line engine for people who think faster than dashboards.
  Runs against a local model, streams answers into the terminal, and
  keeps your prompts on your disk.

  PERSONA ..... direct, technical, no fluff
  FILTERS ..... none added by APEX
  PROVIDERS ... Ollama / OpenAI-compatible
  CEILING ..... whatever your hardware can hold

  The demo you're typing into is canned. Flip the link to LOCAL and
  this terminal starts talking to the model on your machine.`,
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

  Terminal is warm. Ask for code, a system design, a launch plan,
  or something stranger. Type /help for the local command set.`,
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

  Then ask me again.`;
}

async function streamDemo({
  messages,
  onToken,
  signal,
}: StreamOptions): Promise<void> {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = demoAnswerFor(last?.content ?? "");
  const chunks = text.match(/.{1,3}/gs) ?? [text];

  for (const chunk of chunks) {
    if (signal.aborted) return;
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 8 + Math.random() * 16));
  }
}
