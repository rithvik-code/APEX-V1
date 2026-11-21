import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ENDPOINT, DEFAULT_PLANNER, DEFAULT_VISION } from "./planner.mjs";

/*
 * LOCAL BRAIN — model inventory, task routing and latency.
 *
 * One Ollama daemon can hold a dozen models with very different jobs. This
 * module answers the only question that matters at request time: which
 * installed model should handle quick chat, hard reasoning, a screenshot,
 * code, and embeddings. Everything is derived from what is actually on disk;
 * a route that names a missing model falls back to the best installed match
 * instead of failing the request.
 */

export const APEX_HOME = path.join(os.homedir(), ".apex");
export const BRAIN_FILE = path.join(APEX_HOME, "brain.json");

export const ROLES = ["fast", "balanced", "strong", "vision", "code", "embed"];

export const ROLE_LABEL = {
  fast: "QUICK REPLY",
  balanced: "DAY DRIVER",
  strong: "RACE PACE",
  vision: "EYES",
  code: "WRENCH",
  embed: "RECALL",
};

export const ROLE_HINT = {
  fast: "Short questions, status, voice replies.",
  balanced: "Default chat and page answers.",
  strong: "Multi-step reasoning and long briefs.",
  vision: "Screens, photos and page images.",
  code: "Reading and writing source code.",
  embed: "Project and memory search vectors.",
};

const MODEL_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const DEFAULT_ROUTING = {
  fast: "",
  balanced: "",
  strong: "",
  vision: process.env.APEX_VISION_MODEL || DEFAULT_VISION,
  code: "",
  embed: "",
};

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Write through a temp file so a crash never leaves half a JSON document. */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
  return value;
}

export { readJson };

export function readRouting() {
  const stored = readJson(BRAIN_FILE, {}).routing;
  const routing = { ...DEFAULT_ROUTING };
  if (stored && typeof stored === "object") {
    for (const role of ROLES) {
      const value = stored[role];
      if (typeof value === "string" && (!value || MODEL_NAME_OK.test(value))) {
        routing[role] = value;
      }
    }
  }
  return routing;
}

export function writeRouting(patch) {
  const current = readJson(BRAIN_FILE, {});
  const routing = { ...readRouting() };
  for (const role of ROLES) {
    const value = patch?.[role];
    if (value === undefined) continue;
    if (value === null || value === "") {
      routing[role] = "";
      continue;
    }
    if (typeof value !== "string" || !MODEL_NAME_OK.test(value.trim())) {
      throw new Error(`Invalid model name for ${role}`);
    }
    routing[role] = value.trim();
  }
  writeJson(BRAIN_FILE, { ...current, routing });
  return routing;
}

function parameterBillions(name, details) {
  const size = name.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i);
  if (size) return parseFloat(size[1]);
  const label = String(details?.parameter_size || "").toUpperCase();
  const tagged = label.match(/^(\d+(?:\.\d+)?)\s*B$/);
  return tagged ? parseFloat(tagged[1]) : 0;
}

/** Name and capability heuristics, in that order, because Ollama reports both. */
export function classify(name, capabilities = []) {
  const caps = new Set(Array.isArray(capabilities) ? capabilities : []);
  const vision =
    caps.has("vision") ||
    /gemma3|llava|moondream|minicpm|granite3\.2-vision|qwen2\.5-vl|qwen2\.5vl|vision/i.test(name);
  const embed = caps.has("embeddings") || /embed|bge[-:_]|nomic|minilm|mxbai|jina|e5-|gte/i.test(name);
  const code = /coder|code(?:llama|qwen|starcoder)|starcoder|deepseek-coder/i.test(name);
  return { vision, embed, code };
}

async function tags(endpoint, signal) {
  const res = await fetch(`${String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "")}/api/tags`, {
    signal: signal ?? AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.models) ? data.models : [];
}

/** Every installed model, tagged with the roles it can actually fill. */
export async function inventory(endpoint = DEFAULT_ENDPOINT, signal) {
  const models = await tags(endpoint, signal);
  return models
    .map((model) => {
      const name = String(model.name || model.model || "");
      const flags = classify(name, model.capabilities);
      const params = parameterBillions(name, model.details);
      return {
        name,
        size: Number(model.size) || 0,
        params,
        family: String(model.details?.family || ""),
        quant: String(model.details?.quantization_level || ""),
        ...flags,
        chat: !flags.embed,
      };
    })
    .filter((model) => model.name);
}

function bySize(a, b) {
  return (a.params || 99) - (b.params || 99) || a.name.localeCompare(b.name);
}

function closest(models, target) {
  return [...models].sort(
    (a, b) => Math.abs((a.params || 8) - target) - Math.abs((b.params || 8) - target),
  )[0];
}

/** Best installed model for a role, ignoring the saved route. */
export function autoPick(role, models) {
  const chat = models.filter((model) => model.chat && !model.code);
  const code = models.filter((model) => model.code && model.chat);
  switch (role) {
    case "vision":
      return [...models.filter((model) => model.vision)].sort(bySize)[0]?.name ?? "";
    case "embed":
      return models.find((model) => model.embed)?.name ?? "";
    case "code":
      return [...code].sort(bySize)[0]?.name ?? "";
    case "fast": {
      const small = chat.filter((model) => model.params > 0 && model.params <= 3.5);
      return (small.length ? [...small].sort(bySize) : [...chat].sort(bySize))[0]?.name ?? "";
    }
    case "strong":
      return [...chat].sort((a, b) => (b.params || 0) - (a.params || 0))[0]?.name ?? "";
    case "balanced":
    default:
      return closest(chat, 5)?.name ?? "";
  }
}

/**
 * Resolve a role against installed models. A saved route wins only while that
 * model is present, so uninstalling a model degrades to the next best one
 * instead of breaking every request that used it.
 */
export function resolveRole(role, models, routing = readRouting()) {
  const saved = routing[role];
  if (saved && models.some((model) => model.name === saved)) return saved;
  return autoPick(role, models);
}

export function routingSnapshot(models, routing = readRouting()) {
  return ROLES.map((role) => {
    const resolved = resolveRole(role, models, routing);
    return {
      role,
      label: ROLE_LABEL[role],
      hint: ROLE_HINT[role],
      model: resolved,
      source: routing[role] === resolved && resolved ? "SET" : resolved ? "AUTO" : "MISSING",
      installed: models.some((model) => model.name === resolved),
      options: models
        .filter((model) =>
          role === "vision"
            ? model.vision
            : role === "embed"
              ? model.embed
              : role === "code"
                ? model.code
                : model.chat && !model.code,
        )
        .map((model) => model.name),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* LATENCY — measured, not guessed                                             */
/* -------------------------------------------------------------------------- */

const latency = new Map();

export function recordLatency(model, ms, ok = true, note = "") {
  if (!model) return;
  const entry = latency.get(model) ?? { samples: [], errors: 0, lastNote: "" };
  entry.samples.push(Math.round(ms));
  while (entry.samples.length > 12) entry.samples.shift();
  if (!ok) entry.errors += 1;
  entry.lastNote = String(note || "").slice(0, 160);
  latency.set(model, entry);
}

export function latencySnapshot() {
  return [...latency.entries()]
    .map(([model, entry]) => {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      return {
        model,
        runs: entry.samples.length,
        errors: entry.errors,
        lastMs: entry.samples[entry.samples.length - 1] ?? null,
        medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        lastNote: entry.lastNote,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));
}

/** JSON contract that keeps reasoning models from leaking their analysis. */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

/** Pull the user-facing answer out of a JSON reply, or fall back to clean text. */
export function parseAnswer(raw, fallback = "") {
  const text = String(raw || "").replace(/<\/?think>/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (typeof parsed?.answer === "string" && parsed.answer.trim()) return parsed.answer.trim();
    } catch {
      // Not JSON; the cleaned text is still the best available answer.
    }
  }
  return text || fallback;
}

/** Timed chat wrapper so every routed call feeds the command center. */
export async function timed(model, task) {
  const started = Date.now();
  try {
    const value = await task();
    recordLatency(model, Date.now() - started, true);
    return value;
  } catch (error) {
    recordLatency(model, Date.now() - started, false, error?.message);
    throw error;
  }
}

export { DEFAULT_ENDPOINT, DEFAULT_PLANNER, DEFAULT_VISION };
