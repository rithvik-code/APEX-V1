import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultRoots, readControlConfig } from "./files.mjs";

/*
 * Read-only workspace scan for the PADDOCK garage. It never accepts a path
 * from the caller: the daemon walks the configured file roots and returns
 * only project metadata (folder name, marker kind, file count, git branch and
 * last commit time). No file contents and no absolute paths leave the daemon.
 */

const MAX_PROJECTS = 40;
const MAX_DIRS = 700;
const MAX_FILES = 4000;
const MAX_DEPTH = 3;
const CACHE_MS = 30_000;

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".idea",
  ".vscode",
  ".gradle",
  ".git",
  ".apex",
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  "cyrus os",
]);

const PYTHON_MARKERS = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"];
const NODE_MARKERS = ["package.json"];
const OTHER_MARKERS = [
  ["Cargo.toml", "RUST"],
  ["go.mod", "GO"],
  ["Gemfile", "UNKNOWN"],
];

let cache = { at: 0, value: null };

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function hasFile(dir, name) {
  try {
    return fs.statSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function detectKind(dir) {
  const names = new Set(listDir(dir).map((entry) => entry.name));
  const hasDotnet = [...names].some(
    (name) => name.endsWith(".csproj") || name.endsWith(".sln"),
  );
  if (hasDotnet) return "DOTNET";
  if (names.has("Cargo.toml")) return "RUST";
  if (names.has("go.mod")) return "GO";
  if (PYTHON_MARKERS.some((marker) => names.has(marker))) {
    // A Python project that also ships a JS app is still a web project.
    return names.has("index.html") && names.has("package.json") ? "WEB" : "PYTHON";
  }
  for (const marker of NODE_MARKERS) {
    if (!names.has(marker)) continue;
    return names.has("index.html") || names.has("vite.config.ts") ? "WEB" : "NODE";
  }
  for (const [marker, kind] of OTHER_MARKERS) {
    if (names.has(marker)) return kind;
  }
  if (names.has(".git")) return "GIT";
  return null;
}

function gitMeta(dir) {
  const gitDir = path.join(dir, ".git");
  if (!isDir(gitDir)) return { branch: "", lastCommitAt: 0 };
  let branch = "";
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").slice(0, 200).trim();
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (match) branch = match[1].replace(/[^\w./-]/g, "").slice(0, 40);
    else if (/^[0-9a-f]{7,40}$/i.test(head)) branch = "detached";
  } catch {
    // No HEAD: treat as a plain folder.
  }
  let lastCommitAt = 0;
  const logPath = path.join(gitDir, "logs", "HEAD");
  try {
    const size = fs.statSync(logPath).size;
    const length = Math.min(4096, size);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    const lines = buffer.toString("utf8").trim().split("\n");
    const last = lines[lines.length - 1] || "";
    const match = last.match(/\s(\d{9,11})\s[+-]\d{4}/);
    if (match) lastCommitAt = Number(match[1]) * 1000;
  } catch {
    // No reflog.
  }
  if (!lastCommitAt) {
    try {
      lastCommitAt = Math.floor(fs.statSync(gitDir).mtimeMs);
    } catch {
      lastCommitAt = 0;
    }
  }
  return { branch, lastCommitAt };
}

function countFiles(dir) {
  let files = 0;
  let dirs = 0;
  const stack = [dir];
  while (stack.length && files < MAX_FILES && dirs < 260) {
    const current = stack.pop();
    dirs += 1;
    for (const entry of listDir(current)) {
      if (files >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        files += 1;
      }
    }
  }
  return files;
}

function projectFor(dir, kind) {
  const name = path.basename(dir).slice(0, 40) || "UNTITLED";
  const git = gitMeta(dir);
  let updatedAt = 0;
  try {
    updatedAt = Math.floor(fs.statSync(dir).mtimeMs);
    for (const entry of listDir(dir)) {
      try {
        const stat = fs.statSync(path.join(dir, entry.name));
        updatedAt = Math.max(updatedAt, Math.floor(stat.mtimeMs));
      } catch {
        // Race with the filesystem; skip this entry.
      }
    }
  } catch {
    updatedAt = git.lastCommitAt;
  }
  return {
    id: crypto.createHash("sha1").update(path.resolve(dir)).digest("hex").slice(0, 12),
    name,
    kind,
    files: countFiles(dir),
    updatedAt: Math.max(updatedAt, git.lastCommitAt),
    branch: git.branch,
    lastCommitAt: git.lastCommitAt,
  };
}

export function scanWorkspace(force = false) {
  if (!force && cache.value && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.value, cached: true };
  }

  const config = readControlConfig();
  const configured = Array.isArray(config.fileRoots) ? config.fileRoots : [];
  const roots = [];
  for (const root of [...configured, ...defaultRoots()]) {
    const resolved = path.resolve(String(root));
    if (isDir(resolved) && !roots.includes(resolved)) roots.push(resolved);
  }

  const projects = [];
  const seen = new Set();
  let dirs = 0;

  const visit = (dir, depth) => {
    if (projects.length >= MAX_PROJECTS || dirs >= MAX_DIRS) return;
    dirs += 1;
    const kind = detectKind(dir);
    if (kind) {
      const project = projectFor(dir, kind);
      if (!seen.has(project.id)) {
        seen.add(project.id);
        projects.push(project);
      }
      // A project folder is one constructor; do not count its subpackages.
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const entry of listDir(dir)) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name), depth + 1);
      if (projects.length >= MAX_PROJECTS || dirs >= MAX_DIRS) return;
    }
  };

  for (const root of roots) {
    // The root itself may be a project (the APEX workspace usually is).
    visit(root, 0);
    if (projects.length >= MAX_PROJECTS || dirs >= MAX_DIRS) break;
  }

  projects.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  const value = {
    projects: projects.slice(0, MAX_PROJECTS),
    scannedAt: Date.now(),
    roots: roots.length,
    cached: false,
  };
  cache = { at: Date.now(), value };
  return value;
}
