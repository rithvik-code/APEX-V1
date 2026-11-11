/* -------------------------------------------------------------------------- */
/* Arcade Mode — turns plain model replies into quiz, mission and intel cards. */
/* Presentation only: the real answer is always one click away.                */
/* -------------------------------------------------------------------------- */

export type ArcadeKind = "quiz" | "mission" | "intel";

export type QuizPayload = {
  question: string;
  options: string[];
  correct: number;
  source: "model" | "cloze" | "bank";
};

export type MissionPayload = {
  goal: string;
  capabilities: string[];
  risk: "low" | "medium" | "high";
  steps: string[];
};

export type PosterMotif = "racing" | "code" | "ai" | "local" | "generic";

export type PosterSpec = {
  kicker: string;
  title: string;
  lines: string[];
  stat: string | null;
  motif: PosterMotif;
};

export type ArcadePayload =
  | { kind: "quiz"; quiz: QuizPayload }
  | { kind: "mission"; mission: MissionPayload }
  | { kind: "intel"; poster: PosterSpec };

export type ArcadeStats = {
  xp: number;
  streak: number;
  bestStreak: number;
  quizzes: number;
  correct: number;
};

const MODE_KEY = "apex.arcade.mode.v1";
const STATS_KEY = "apex.arcade.stats.v1";

export function loadArcadeMode(): boolean {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function saveArcadeMode(on: boolean): void {
  try {
    localStorage.setItem(MODE_KEY, on ? "1" : "0");
  } catch {
    // Storage can be blocked; the toggle still applies this session.
  }
}

const EMPTY_STATS: ArcadeStats = {
  xp: 0,
  streak: 0,
  bestStreak: 0,
  quizzes: 0,
  correct: 0,
};

export function loadArcadeStats(): ArcadeStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw) as Partial<ArcadeStats>;
    return {
      xp: Number(parsed.xp) || 0,
      streak: Number(parsed.streak) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
      quizzes: Number(parsed.quizzes) || 0,
      correct: Number(parsed.correct) || 0,
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function awardArcade(
  kind: "quiz-correct" | "quiz-wrong" | "mission",
  stats: ArcadeStats,
): ArcadeStats {
  const next = { ...stats };
  if (kind === "quiz-correct") {
    next.xp += 15;
    next.quizzes += 1;
    next.correct += 1;
    next.streak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
  } else if (kind === "quiz-wrong") {
    next.xp += 4;
    next.quizzes += 1;
    next.streak = 0;
  } else {
    next.xp += 12;
  }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
  return next;
}

// Appended to the system prompt for quiz turns. The strict tail line is parsed
// out of the transcript and never shown as prose.
export const QUIZ_INSTRUCTION = `ARCADE QUIZ: the interface will wrap this reply in a quiz card. Answer normally first, then add one final line, exactly:
QUIZ: <question> | <correct answer> | <wrong answer> | <wrong answer> | <wrong answer>
The question must be answerable from your reply. Every option under 60 characters, no pipes inside the text, no numbering. If the reply has no testable fact, write QUIZ: SKIP instead.`;

const VISUAL_START =
  /^(show me|draw|sketch|diagram|visuali[sz]e|picture|image|poster|illustrate)\b/i;
const QUESTION_START =
  /^(who|what|when|where|which|why|how|is|are|was|were|do|does|did|can|could|should|would|will|has|have|explain|define|compare)\b/i;

export function isQuizAsk(text: string): boolean {
  const t = text.trim();
  if (VISUAL_START.test(t)) return false;
  if (/\b(quiz|trivia|test me|challenge me|pop quiz)\b/i.test(t)) return true;
  return t.endsWith("?") || QUESTION_START.test(t);
}

export function classifyArcade(text: string, hasHandoff: boolean): ArcadeKind {
  if (hasHandoff) return "mission";
  if (isQuizAsk(text)) return "quiz";
  return "intel";
}

/* ------------------------------- missions -------------------------------- */

export function buildMission(goal: string): MissionPayload {
  const capabilities: string[] = [];
  const add = (cap: string) => {
    if (!capabilities.includes(cap)) capabilities.push(cap);
  };
  if (/\b(browser|tab|website|site|page|http|www\.|navigate|url|chrome|edge|firefox)\b/i.test(goal)) {
    add("BROWSER");
  }
  if (/\b(click|type|fill|submit|search|select|press)\b/i.test(goal)) {
    add("MOUSE");
    add("KEYBOARD");
  }
  if (/\b(file|folder|save|read|write|rename|download)\b/i.test(goal)) add("FILES");
  if (/\b(command|terminal|shell|script|npm|node|git|run)\b/i.test(goal)) add("TERMINAL");
  if (/\b(app|launch|open|focus|window)\b/i.test(goal)) add("APPS");
  if (!capabilities.length) {
    add("SCREEN");
    add("MOUSE");
    add("KEYBOARD");
  }

  const risk: MissionPayload["risk"] = /\b(delete|remove|format|overwrite|drop|pay|purchase|send|email|post|wipe)\b/i.test(
    goal,
  )
    ? "high"
    : /\b(change|edit|submit|install|download|move|rename|update)\b/i.test(goal)
      ? "medium"
      : "low";

  const steps: string[] = [];
  if (capabilities.includes("BROWSER")) {
    steps.push("Open the target tab and confirm the right page loaded.");
  }
  if (capabilities.includes("MOUSE") || capabilities.includes("KEYBOARD")) {
    steps.push("Locate the exact control, act once, then re-read the screen.");
  }
  if (capabilities.includes("FILES")) {
    steps.push("Touch only the named file; keep a copy before any overwrite.");
  }
  if (capabilities.includes("TERMINAL")) {
    steps.push("Run the precise command and capture its output.");
  }
  if (capabilities.includes("APPS")) {
    steps.push("Launch or focus the app and verify it is in front.");
  }
  if (!steps.length) steps.push("Confirm the target state before acting.");
  steps.push("Stop on any unexpected dialog and hand back for approval.");

  return { goal, capabilities, risk, steps: steps.slice(0, 4) };
}

/* --------------------------------- quizzes -------------------------------- */

const QUIZ_LINE = /^[ \t]*QUIZ:[ \t]*(.+)$/im;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function extractQuiz(raw: string): { text: string; quiz: QuizPayload | null } {
  const match = raw.match(QUIZ_LINE);
  if (!match) return { text: raw, quiz: null };
  const text = raw
    .replace(QUIZ_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  const payload = match[1].trim();
  if (!payload || /^skip\b/i.test(payload)) return { text, quiz: null };
  const parts = payload
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 5) return { text, quiz: null };
  const [question, correct, ...wrong] = parts;
  if (!question || !correct) return { text, quiz: null };
  const unique = Array.from(new Set([correct, ...wrong.slice(0, 3)]));
  if (unique.length < 4) return { text, quiz: null };
  const options = shuffled(unique);
  return {
    text,
    quiz: { question, options, correct: options.indexOf(correct), source: "model" },
  };
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const NAME_STOP = new Set([
  "The", "This", "That", "These", "Those", "When", "Then", "There", "Your",
  "You", "Its", "It's", "And", "But", "For", "With", "From", "Into", "Every",
  "Most", "Some", "Each", "Both", "None", "Never", "Always", "Use", "Run",
  "Ask", "Open", "Point", "Pull", "No", "Never", "APEX", "LOCAL", "WEB",
]);

function cleanForCloze(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/SOURCES ─[\s\S]*$/i, " ")
    .replace(/^[ \t]*[A-Z0-9][A-Z0-9 /&.'()_:-]{3,}[ \t]*$/gm, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function clipAround(sentence: string, token: string, max = 150): string {
  if (sentence.length <= max) return sentence;
  const at = sentence.indexOf(token);
  const start = Math.max(0, at - Math.floor(max / 2));
  const end = Math.min(sentence.length, start + max);
  return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${
    end < sentence.length ? "…" : ""
  }`;
}

function numberVariants(token: string): string[] {
  const match = token.match(/^(\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return [];
  const value = parseFloat(match[1].replace(",", "."));
  const suffix = match[2] ?? "";
  const integral = !match[1].includes(".") && !match[1].includes(",");
  const out: string[] = [];
  for (const factor of [0.5, 1.5, 2, 0.75]) {
    const next = value * factor;
    const rendered = integral
      ? String(Math.max(1, Math.round(next)))
      : next.toFixed(1);
    const candidate = `${rendered}${suffix}`;
    if (candidate !== token && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

// Builds a fill-the-blank question from the answer itself, so quizzes still
// work in demo mode or with models that ignore the QUIZ instruction.
export function clozeQuiz(raw: string): QuizPayload | null {
  const clean = cleanForCloze(raw);
  if (clean.length < 80) return null;
  const allNames = Array.from(
    new Set(
      (clean.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? []).filter(
        (name) => !NAME_STOP.has(name),
      ),
    ),
  );
  const sentences = clean
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 260);

  for (const sentence of sentences) {
    const numbers = (sentence.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).filter(
      (token) => token.replace(/\D/g, "").length >= 1,
    );
    const names = (sentence.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? []).filter(
      (name) => !NAME_STOP.has(name),
    );
    const numericTarget = numbers.find((token) => token.length >= 2);
    const nameTarget = names.find((name) => sentence.indexOf(name) > 0);

    for (const target of [numericTarget, nameTarget]) {
      if (!target) continue;
      const distractors = new Set<string>();
      if (numbers.includes(target)) {
        for (const number of numbers) {
          if (number !== target) distractors.add(number);
        }
        for (const variant of numberVariants(target)) distractors.add(variant);
      } else {
        for (const name of allNames) {
          if (name !== target) distractors.add(name);
        }
      }
      for (const number of numbers) {
        if (distractors.size >= 3) break;
        if (number !== target) distractors.add(number);
      }
      if (distractors.size < 3) continue;

      const blanked = clipAround(sentence, target).replace(target, "____");
      const options = shuffled([target, ...Array.from(distractors).slice(0, 3)]);
      return {
        question: `Complete the line: “${blanked}”`,
        options,
        correct: options.indexOf(target),
        source: "cloze",
      };
    }
  }
  return null;
}

const QUIZ_BANK: Array<{ question: string; correct: string; wrong: string[] }> = [
  {
    question: "What generates most of a modern F1 car's downforce?",
    correct: "The floor and diffuser",
    wrong: ["The rear wing only", "The front wing only", "Exhaust gases"],
  },
  {
    question: "What does opening DRS do?",
    correct: "Stalls the rear wing to cut drag",
    wrong: ["Cools the brakes", "Adds cornering downforce", "Increases fuel flow"],
  },
  {
    question: "What does a diffuser do?",
    correct: "Speeds air under the car to lower pressure",
    wrong: ["Cools the gearbox", "Feeds the turbo", "Directs air into the radiator"],
  },
  {
    question: "What is trail braking?",
    correct: "Releasing brake pressure as you turn in",
    wrong: ["Braking only in a straight line", "Braking with the rear wheels only", "Using the handbrake to rotate"],
  },
  {
    question: "What does understeer feel like?",
    correct: "The car pushes wide and needs less steering",
    wrong: ["The rear steps out under power", "The car snaps sideways on braking", "The wheel goes light at top speed"],
  },
  {
    question: "What is the apex of a corner?",
    correct: "The tightest point of the corner",
    wrong: ["The braking marker", "The exit kerb", "The start of the straight"],
  },
  {
    question: "Why do F1 cars use carbon-ceramic brakes?",
    correct: "They are light and hold heat",
    wrong: ["They are cheap to replace", "They work best when cold", "They reduce downforce"],
  },
  {
    question: "Which tyre compound is usually fastest over one lap?",
    correct: "Soft",
    wrong: ["Medium", "Hard", "Wet"],
  },
  {
    question: "What does slip angle describe?",
    correct: "The gap between where the car points and where it moves",
    wrong: ["The angle of the steering wheel", "The tilt of the rear wing", "The slope of the track"],
  },
  {
    question: "In this app, what is the ghost lap?",
    correct: "Your best lap replayed from recorded samples",
    wrong: ["A live second player", "A random AI car", "The ideal racing line overlay"],
  },
  {
    question: "What is the job of the ECU in a race car?",
    correct: "Engine and gearbox management",
    wrong: ["Tyre pressure control", "Brake cooling", "Fuel tank venting"],
  },
  {
    question: "How long is the Time Attack circuit in this build?",
    correct: "About 1.7 km",
    wrong: ["About 230 m", "About 5 km", "About 700 m"],
  },
];

export function bankQuiz(): QuizPayload {
  const item = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
  const options = shuffled([item.correct, ...item.wrong.slice(0, 3)]);
  return {
    question: item.question,
    options,
    correct: options.indexOf(item.correct),
    source: "bank",
  };
}

/* --------------------------------- posters -------------------------------- */

function detectMotif(raw: string): PosterMotif {
  if (/\b(race|racing|f1|formula|circuit|lap|apex|circuit|downforce|aero|dyno|track|bike|car)\b/i.test(raw)) {
    return "racing";
  }
  if (/\b(code|function|typescript|javascript|react|python|api|build|npm|script|component|class)\b/i.test(raw)) {
    return "code";
  }
  if (/\b(ollama|inference|token|llm|model|prompt|embedding|agent|gpu)\b/i.test(raw)) {
    return "ai";
  }
  if (/\b(install|local|daemon|machine|hardware|setup|terminal)\b/i.test(raw)) {
    return "local";
  }
  return "generic";
}

function stripDecor(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/SOURCES ─[\s\S]*$/i, " ")
    .replace(/[|#*_`]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function pickStat(raw: string): string | null {
  const matches = raw.match(/\b\d+(?:[.,]\d+)?\s?(?:%|GB|MB|ms|s|km\/h|m)\b/gi);
  if (matches?.length) return matches[0].replace(/\s+/g, " ").toUpperCase();
  const big = raw.match(/\b\d{3,}\b/);
  return big ? big[0] : null;
}

export function buildPoster(raw: string, query: string): PosterSpec {
  const headings = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z0-9][A-Z0-9 /&.'()_:-]{3,}$/.test(line));
  const clean = stripDecor(raw);
  const sentences = clean
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && !/^https?:/i.test(sentence));

  const lines: string[] = [];
  for (const sentence of sentences) {
    const clipped = sentence.length > 118 ? `${sentence.slice(0, 115).trim()}…` : sentence;
    if (!lines.includes(clipped)) lines.push(clipped);
    if (lines.length === 3) break;
  }
  if (!lines.length && clean) lines.push(clean.slice(0, 118));

  const heading = headings[0];
  const titleSource =
    heading ??
    (query
      .replace(/[?.!]+$/, "")
      .split(/\s+/)
      .slice(0, 6)
      .join(" ") ||
      "APEX INTEL");

  return {
    kicker: `APEX ARCADE // ${detectMotif(`${raw} ${query}`).toUpperCase()}`,
    title: titleSource.toUpperCase().slice(0, 42),
    lines,
    stat: pickStat(raw),
    motif: detectMotif(`${raw} ${query}`),
  };
}

export function buildArcadePayload(
  kind: ArcadeKind,
  raw: string,
  query: string,
): { text: string; payload: ArcadePayload } {
  if (kind === "mission") {
    return { text: raw, payload: { kind: "mission", mission: buildMission(query) } };
  }
  if (kind === "quiz") {
    const extracted = extractQuiz(raw);
    const quiz = extracted.quiz ?? clozeQuiz(extracted.text) ?? bankQuiz();
    return { text: extracted.text, payload: { kind: "quiz", quiz } };
  }
  return { text: raw, payload: { kind: "intel", poster: buildPoster(raw, query) } };
}

/* --------------------------------- paint --------------------------------- */

const ACCENT = "#c8ff16";

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 24) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 2))}…`;
    }
  }
  return lines;
}

function paintMotif(
  ctx: CanvasRenderingContext2D,
  motif: PosterMotif,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (motif === "racing") {
    const pts: Array<[number, number]> = [
      [0.08, 0.72], [0.16, 0.42], [0.4, 0.28], [0.62, 0.36],
      [0.78, 0.58], [0.66, 0.8], [0.42, 0.86], [0.22, 0.78], [0.12, 0.6],
    ].map(([px, py]) => [px * w, py * h]);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 5;
    ctx.shadowColor = "rgba(200,255,22,0.55)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py);
      else {
        const [prevX, prevY] = pts[i - 1];
        ctx.quadraticCurveTo(prevX, prevY, (prevX + px) / 2, (prevY + py) / 2);
      }
    });
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pts[0][0] - 14, pts[0][1] - 3, 28, 6);
  } else if (motif === "code") {
    const rows = [0.22, 0.36, 0.5, 0.64, 0.78];
    rows.forEach((row, index) => {
      const indent = index === 3 ? 34 : index === 4 ? 18 : 0;
      const width = [0.62, 0.44, 0.74, 0.38, 0.54][index] * w;
      ctx.fillStyle = index === 1 ? ACCENT : "rgba(255,255,255,0.22)";
      ctx.fillRect(indent, row * h, width, 7);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(indent, row * h + 13, width * 0.6, 3);
    });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.font = "700 92px 'Archivo', Arial, sans-serif";
    ctx.fillStyle = ACCENT;
    ctx.fillText("{ }", w * 0.58, h * 0.62);
  } else if (motif === "ai") {
    const nodes: Array<[number, number]> = [
      [0.18, 0.3], [0.42, 0.18], [0.68, 0.3], [0.8, 0.58],
      [0.56, 0.76], [0.3, 0.62], [0.5, 0.46],
    ].map(([px, py]) => [px * w, py * h]);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if ((i + j) % 2 !== 0) continue;
        ctx.beginPath();
        ctx.moveTo(nodes[i][0], nodes[i][1]);
        ctx.lineTo(nodes[j][0], nodes[j][1]);
        ctx.stroke();
      }
    }
    nodes.forEach(([cx, cy], index) => {
      const center = index === 6;
      ctx.beginPath();
      ctx.arc(cx, cy, center ? 12 : 7, 0, Math.PI * 2);
      ctx.fillStyle = center ? ACCENT : "rgba(255,255,255,0.5)";
      ctx.shadowColor = center ? "rgba(200,255,22,0.7)" : "transparent";
      ctx.shadowBlur = center ? 22 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  } else if (motif === "local") {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(w * 0.52, h * 0.5, 36 + i * 26, 0, Math.PI * 2);
      ctx.strokeStyle = i === 1 ? ACCENT : "rgba(255,255,255,0.14)";
      ctx.lineWidth = i === 1 ? 3 : 1.2;
      ctx.stroke();
    }
    const size = 34;
    ctx.fillStyle = "rgba(200,255,22,0.14)";
    ctx.fillRect(w * 0.52 - size, h * 0.5 - size, size * 2, size * 2);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.52 - size, h * 0.5 - size, size * 2, size * 2);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(w * 0.52 - 6, h * 0.5 - 6, 12, 12);
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(w * 0.3 + i * 22, h * 0.7 - i * 18, 30 + i * 22, Math.PI * 1.1, Math.PI * 1.85);
      ctx.strokeStyle = i % 2 === 0 ? "rgba(200,255,22,0.85)" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function paintPoster(canvas: HTMLCanvasElement, spec: PosterSpec): void {
  const W = 960;
  const H = 540;
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.78, H * 0.16, 20, W * 0.78, H * 0.16, 520);
  glow.addColorStop(0, "rgba(200,255,22,0.2)");
  glow.addColorStop(0.55, "rgba(200,255,22,0.05)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.fillStyle = ACCENT;
  ctx.fillRect(48, 0, 2, H);

  paintMotif(ctx, spec.motif, 570, 100, 330, 320);

  ctx.fillStyle = ACCENT;
  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.fillText(spec.kicker, 64, 84);

  ctx.fillStyle = "#f2f4ee";
  ctx.font = "800 44px 'Archivo', Arial, sans-serif";
  const titleLines = wrapLines(ctx, spec.title, 460, 3);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 64, 142 + index * 50);
  });

  const ruleY = 154 + (titleLines.length - 1) * 50;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(64, ruleY, 74, 3);

  ctx.font = "400 17px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(236,240,230,0.82)";
  spec.lines.forEach((line, index) => {
    const wrapped = wrapLines(ctx, line, 470, 2);
    wrapped.forEach((part, partIndex) => {
      ctx.fillText(part, 64, ruleY + 38 + index * 52 + partIndex * 20);
    });
  });

  if (spec.stat) {
    ctx.fillStyle = ACCENT;
    ctx.font = "800 54px 'Archivo', Arial, sans-serif";
    const width = ctx.measureText(spec.stat).width;
    ctx.fillText(spec.stat, 900 - width, 470);
    ctx.font = "500 12px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(236,240,230,0.5)";
    ctx.fillText("KEY FIGURE", 900 - width, 492);
  }

  ctx.fillStyle = "rgba(236,240,230,0.42)";
  ctx.font = "500 12px 'IBM Plex Mono', monospace";
  ctx.fillText("APEX ARCADE // INTEL CARD", 64, 506);
  const date = new Date().toISOString().slice(0, 10);
  ctx.fillText(date, 806, 506);
}
