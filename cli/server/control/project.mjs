import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ENDPOINT } from "./planner.mjs";
import { chat } from "./planner.mjs";
import { ANSWER_SCHEMA, inventory, parseAnswer, resolveRole, timed } from "./brain.mjs";

/*
 * PROJECT AWARENESS — a searchable map of APEX's own code, features and docs.
 *
 * Files are chunked by line, scored with a local TF-IDF index, and (when an
 * embedding model is installed) reranked by vector similarity. Nothing leaves
 * the machine and no cloud index is involved. The lexical layer is always
 * available, so search works even with no models pulled at all.
 */

export const PROJECT_ROOT = path.resolve(process.env.APEX_PROJECT_ROOT || process.cwd());
const INDEX_FILE = path.join(os.homedir(), ".apex", "project-index.json");
const INDEX_VERSION = 1;

const MAX_FILES = 900;
const MAX_FILE_BYTES = 320_000;
const MAX_DEPTH = 6;
const CHUNK_CHARS = 1400;
const EMBED_LIMIT = 700;

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", ".git", ".apex", ".freebuff",
  ".cloud-attachments", "shots", "__pycache__", ".venv", "venv", ".next", ".turbo",
  ".cache", ".parcel-cache", ".idea", ".vscode", "target", "bin", "obj",
]);

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".css",
  ".html", ".py", ".ps1", ".yml", ".yaml", ".toml", ".txt", ".sh", ".bat", ".sql",
  ".rs", ".go", ".java", ".c", ".h", ".cpp", ".svg",
]);

export const state = {
  status: "idle",
  root: PROJECT_ROOT,
  files: 0,
  chunks: 0,
  embedded: 0,
  mode: "lexical",
  embedModel: "",
  startedAt: 0,
  finishedAt: 0,
  error: "",
};

let index = null;
let building = null;
let persistedLoaded = false;

function walk(dir, depth, out) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      walk(full, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

function tokenize(text) {
  const raw = String(text)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9_$]{2,}/g);
  return raw ?? [];
}

function chunkText(rel, text) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < lines.length; i += 1) {
    size += lines[i].length + 1;
    const last = i === lines.length - 1;
    if (size < CHUNK_CHARS && !last) continue;
    const body = lines.slice(start, i + 1).join("\n").trim();
    if (body.length >= 40) {
      chunks.push({
        file: rel,
        start: start + 1,
        end: i + 1,
        text: body.slice(0, CHUNK_CHARS + 600),
      });
    }
    start = Math.max(start, i - 1);
    size = lines.slice(start, i + 1).join("\n").length + 1;
  }
  return chunks;
}

async function embedTexts(texts, model) {
  const res = await fetch(`${DEFAULT_ENDPOINT.replace(/\/+$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`Embedding model returned ${res.status}`);
  const data = await res.json();
  const vectors = data.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error("Embedding model returned an unexpected shape");
  }
  return vectors.map((vector) => (Array.isArray(vector) ? vector.map((value) => Math.round(value * 1000) / 1000) : []));
}

async function embedAll(chunks) {
  const models = await inventory(DEFAULT_ENDPOINT).catch(() => []);
  const model = resolveRole("embed", models);
  if (!model) return { embedded: 0, model: "" };
  // Source code is the priority when the model has to stop early.
  const order = chunks
    .map((chunk, position) => ({ chunk, position }))
    .sort((a, b) => Number(/^src\//.test(b.chunk.file)) - Number(/^src\//.test(a.chunk.file)));
  const targets = order.slice(0, EMBED_LIMIT).map((entry) => entry.chunk);
  let embedded = 0;
  for (let i = 0; i < targets.length; i += 16) {
    const batch = targets.slice(i, i + 16);
    try {
      const vectors = await embedTexts(batch.map((chunk) => `${chunk.file}\n${chunk.text}`), model);
      batch.forEach((chunk, position) => {
        chunk.vec = vectors[position];
        embedded += 1;
      });
    } catch {
      // A model that refuses batching leaves the remaining chunks lexical.
      break;
    }
  }
  return { embedded, model: embedded ? model : "" };
}

function computeStats(chunks) {
  const df = new Map();
  for (const chunk of chunks) {
    const terms = new Set(tokenize(`${chunk.file} ${chunk.text}`));
    chunk.terms = terms.size;
    for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return df;
}

function persist() {
  if (!index) return;
  try {
    fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
    fs.writeFileSync(
      INDEX_FILE,
      JSON.stringify({ version: INDEX_VERSION, ...index, df: [...index.df] }),
    );
  } catch {
    // The index stays in memory; a read-only home directory is not fatal.
  }
}

function loadPersisted() {
  if (persistedLoaded || index) return;
  persistedLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    if (raw?.version !== INDEX_VERSION || raw.root !== PROJECT_ROOT || !Array.isArray(raw.chunks)) return;
    index = {
      root: raw.root,
      at: raw.at,
      mode: raw.mode,
      embedModel: raw.embedModel || "",
      chunks: raw.chunks,
      df: new Map(Array.isArray(raw.df) ? raw.df : []),
    };
    state.status = "ready";
    state.root = index.root;
    state.mode = index.mode;
    state.embedModel = index.embedModel;
    state.files = new Set(index.chunks.map((chunk) => chunk.file)).size;
    state.chunks = index.chunks.length;
    state.embedded = index.chunks.filter((chunk) => chunk.vec).length;
    state.finishedAt = index.at;
  } catch {
    // No usable index yet.
  }
}

export function indexStatus() {
  loadPersisted();
  return {
    ...state,
    root: PROJECT_ROOT,
    age: index ? Date.now() - index.at : null,
    building: Boolean(building),
  };
}

export async function buildIndex({ embed = true } = {}) {
  if (building) return building;
  building = (async () => {
    state.status = "indexing";
    state.error = "";
    state.startedAt = Date.now();
    try {
      const files = walk(PROJECT_ROOT, 0, []);
      const chunks = [];
      for (const full of files) {
        const rel = path.relative(PROJECT_ROOT, full).replace(/\\/g, "/");
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        chunks.push(...chunkText(rel, text));
      }
      const at = Date.now();
      index = {
        root: PROJECT_ROOT,
        at,
        mode: "lexical",
        embedModel: "",
        chunks,
        df: computeStats(chunks),
      };
      state.files = files.length;
      state.chunks = chunks.length;
      state.embedded = 0;
      state.mode = "lexical";
      state.embedModel = "";
      state.status = "ready";
      if (embed) {
        const result = await embedAll(chunks).catch(() => ({ embedded: 0, model: "" }));
        if (result.embedded) {
          index.mode = "hybrid";
          index.embedModel = result.model;
          state.mode = "hybrid";
          state.embedModel = result.model;
          state.embedded = result.embedded;
        }
      }
      state.finishedAt = Date.now();
      persist();
    } catch (error) {
      state.status = "error";
      state.error = String(error?.message || "Index build failed").slice(0, 240);
    } finally {
      building = null;
    }
    return indexStatus();
  })();
  return building;
}

function idf(df, total, term) {
  const count = df.get(term) ?? 0;
  return Math.log(1 + total / (1 + count));
}

function lexicalScore(terms, chunk, df, total) {
  const haystack = tokenize(`${chunk.file} ${chunk.text}`);
  const counts = new Map();
  for (const term of haystack) counts.set(term, (counts.get(term) ?? 0) + 1);
  let score = 0;
  for (const term of terms) {
    const tf = counts.get(term) ?? 0;
    if (!tf) continue;
    score += idf(df, total, term) * (1 + Math.log(tf));
    if (chunk.file.toLowerCase().includes(term)) score += 1.6;
  }
  return score / Math.sqrt(1 + Math.sqrt(haystack.length));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export async function searchProject(query, limit = 8) {
  const asked = String(query || "").trim();
  if (!asked) return [];
  if (!index) loadPersisted();
  if (!index) await buildIndex({ embed: false });
  if (!index) return [];
  const terms = [...new Set(tokenize(asked))];
  if (!terms.length) return [];
  const total = index.chunks.length;
  const scored = index.chunks.map((chunk) => ({
    chunk,
    lexical: lexicalScore(terms, chunk, index.df, total),
    vector: 0,
  }));

  if (index.mode === "hybrid" && index.embedModel) {
    try {
      const queryVector = (await embedTexts([asked], index.embedModel))[0];
      for (const entry of scored) entry.vector = cosine(queryVector, entry.chunk.vec);
    } catch {
      // Query embedding unavailable; lexical results still stand.
    }
  }

  const ranked = scored
    .map((entry) => ({
      ...entry,
      score: entry.lexical + entry.vector * 8,
    }))
    .filter((entry) => entry.lexical > 0 || entry.vector > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(24, limit)));

  return ranked.map((entry, position) => ({
    id: `P${position + 1}`,
    file: entry.chunk.file,
    start: entry.chunk.start,
    end: entry.chunk.end,
    score: Math.round(entry.score * 1000) / 1000,
    snippet: entry.chunk.text.replace(/\s+/g, " ").slice(0, 520),
  }));
}

export function resolveInside(target) {
  const rel = String(target || "").trim();
  const absolute = path.resolve(PROJECT_ROOT, rel);
  const root = PROJECT_ROOT.toLowerCase();
  const resolved = absolute.toLowerCase();
  if (resolved !== root && !resolved.startsWith(root + path.sep.toLowerCase())) {
    throw new Error("That file is outside the project root");
  }
  const lower = resolved.replace(/\\/g, "/");
  if (/\/\.(git|apex|ssh|aws|kube)(\/|$)/.test(lower)) {
    throw new Error("Protected path");
  }
  return absolute;
}

export function readProjectFile(target, { maxChars = 20_000 } = {}) {
  const absolute = resolveInside(target);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) throw new Error("That path is a directory");
  if (stat.size > 8_000_000) throw new Error("That file is too large to read in one pass");
  const text = fs.readFileSync(absolute, "utf8");
  return {
    path: path.relative(PROJECT_ROOT, absolute).replace(/\\/g, "/"),
    chars: text.length,
    truncated: text.length > maxChars,
    text: text.slice(0, Math.max(200, Number(maxChars) || 20_000)),
  };
}

export function listProjectDir(target = ".") {
  const absolute = resolveInside(target || ".");
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".") || entry.name === ".env.example")
    .slice(0, 200)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));
}

export async function askProject({ question, model, limit = 8 } = {}) {
  const asked = String(question || "").trim();
  if (!asked) throw new Error("Ask a question about the project first");
  const sources = await searchProject(asked, limit);
  if (!sources.length) {
    return {
      answer: "I could not find anything in this project that matches that. Try naming a file, a component, or a feature.",
      sources: [],
      model: "",
    };
  }
  const models = await inventory(DEFAULT_ENDPOINT).catch(() => []);
  const chosen = String(model || resolveRole("code", models) || resolveRole("balanced", models)).slice(0, 100);
  const context = sources
    .map((source) => `[${source.id}] ${source.file}:${source.start}-${source.end}\n${source.snippet}`)
    .join("\n\n");
  const answer = await timed(chosen, () =>
    chat({
      model: chosen,
      endpoint: DEFAULT_ENDPOINT,
      temperature: 0.15,
      numCtx: 8192,
      format: ANSWER_SCHEMA,
      think: false,
      timeoutMs: 120000,
      messages: [
        {
          role: "system",
          content:
            "You are Cyrus, the APEX project guide. Answer using only the supplied project excerpts. Cite the files you used with their tags, like [P1]. Name real paths exactly as written. If the excerpts do not answer the question, say what is missing and which file to open. Never invent APIs, files or features.",
        },
        {
          role: "user",
          content: `QUESTION: ${asked}\n\nPROJECT EXCERPTS:\n${context}`,
        },
      ],
    }),
  );
  return {
    answer: parseAnswer(answer, "I found the files below but could not form a clear answer from them."),
    sources,
    model: chosen,
  };
}
