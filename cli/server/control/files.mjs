import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APEX_DIR = path.join(os.homedir(), ".apex");
const SHADOW_ROOT = path.join(APEX_DIR, "shadow", "control");
const CONTROL_ROOT = path.join(APEX_DIR, "control");

const PROTECTED_SEGMENTS = [
  ".apex",
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  "AppData/Roaming/Microsoft/Credentials",
  "AppData/Local/Microsoft/Credentials",
  "AppData/Roaming/Microsoft/Protect",
  ".git",
];

function normalize(target) {
  return path.resolve(target).replace(/[\\/]+$/, "");
}

function inside(target, root) {
  const left = process.platform === "win32" ? target.toLowerCase() : target;
  const right = process.platform === "win32" ? root.toLowerCase() : root;
  return left === right || left.startsWith(right + path.sep);
}

function nearestExisting(target) {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isProtected(target) {
  const clean = target.replace(/\\/g, "/");
  return PROTECTED_SEGMENTS.some((segment) => {
    const needle = segment.replace(/\\/g, "/");
    return clean.includes(`/${needle}/`) || clean.endsWith(`/${needle}`);
  });
}

export function defaultRoots() {
  const home = os.homedir();
  return [
    process.cwd(),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
  ].filter((root) => fs.existsSync(root));
}

export class FileEngine {
  constructor({ roots, sessionId }) {
    this.roots = (roots?.length ? roots : defaultRoots()).map(normalize);
    this.sessionId = sessionId;
    this.shadowDir = path.join(SHADOW_ROOT, sessionId);
    this.manifestPath = path.join(CONTROL_ROOT, sessionId, "writes.jsonl");
  }

  resolve(target, { write = false } = {}) {
    if (!target || typeof target !== "string") throw new Error("A path is required");
    const absolute = path.isAbsolute(target)
      ? normalize(target)
      : normalize(path.resolve(this.roots[0] || process.cwd(), target));
    if (isProtected(absolute)) {
      throw new Error(`Protected path: ${absolute}`);
    }
    const real = fs.existsSync(absolute)
      ? fs.realpathSync.native(absolute)
      : path.join(
          fs.realpathSync.native(nearestExisting(path.dirname(absolute))),
          path.relative(nearestExisting(path.dirname(absolute)), absolute),
        );
    if (!this.roots.some((root) => inside(real, root))) {
      throw new Error(
        `Outside authorized roots. Add a root in ~/.apex/control.json. Allowed: ${this.roots.join(", ")}`,
      );
    }
    if (write && !fs.existsSync(path.dirname(real))) {
      // Parent creation is allowed, but the target must still sit under a root.
    }
    return real;
  }

  list(target = ".") {
    const dir = this.resolve(target);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return {
      path: dir,
      entries: entries.slice(0, 400).map((entry) => {
        let size = 0;
        try {
          if (entry.isFile()) size = fs.statSync(path.join(dir, entry.name)).size;
        } catch {
          // Ignore unreadable files.
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          size,
        };
      }),
    };
  }

  read(target, { maxBytes = 400_000 } = {}) {
    const file = this.resolve(target);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error(`${file} is not a file`);
    if (stat.size > maxBytes) {
      throw new Error(`${file} is ${stat.size} bytes; limit is ${maxBytes}`);
    }
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) throw new Error(`${file} looks binary`);
    return { path: file, size: stat.size, content: buffer.toString("utf8") };
  }

  snapshot(file) {
    if (!fs.existsSync(file)) return null;
    fs.mkdirSync(this.shadowDir, { recursive: true });
    const slot = path.join(
      this.shadowDir,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.copyFileSync(file, slot);
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.appendFileSync(
      this.manifestPath,
      `${JSON.stringify({ ts: new Date().toISOString(), path: file, snapshot: slot })}\n`,
    );
    return slot;
  }

  write(target, content, { append = false } = {}) {
    const file = this.resolve(target, { write: true });
    const snapshot = this.snapshot(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (append) fs.appendFileSync(file, String(content), "utf8");
    else fs.writeFileSync(file, String(content), "utf8");
    return {
      path: file,
      bytes: Buffer.byteLength(String(content), "utf8"),
      snapshot,
      created: !snapshot,
    };
  }

  replace(target, oldText, newText, { all = false } = {}) {
    const file = this.resolve(target, { write: true });
    const before = fs.readFileSync(file, "utf8");
    if (!oldText) throw new Error("old text is empty");
    const count = before.split(oldText).length - 1;
    if (count === 0) throw new Error("old text was not found");
    if (!all && count > 1) {
      throw new Error(`old text appears ${count} times; pass all:true to replace all`);
    }
    const snapshot = this.snapshot(file);
    const next = all
      ? before.split(oldText).join(newText)
      : before.replace(oldText, newText);
    fs.writeFileSync(file, next, "utf8");
    return { path: file, replaced: all ? count : 1, matches: count, snapshot };
  }

  mkdir(target) {
    const dir = this.resolve(target, { write: true });
    fs.mkdirSync(dir, { recursive: true });
    return { path: dir, created: true };
  }

  undo() {
    if (!fs.existsSync(this.manifestPath)) {
      return { restored: 0, removed: 0, errors: [] };
    }
    const lines = fs.readFileSync(this.manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
    let restored = 0;
    let removed = 0;
    const errors = [];
    for (const line of lines.reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.snapshot && fs.existsSync(entry.snapshot)) {
          fs.copyFileSync(entry.snapshot, entry.path);
          restored += 1;
        } else if (!entry.snapshot && fs.existsSync(entry.path)) {
          fs.unlinkSync(entry.path);
          removed += 1;
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    fs.writeFileSync(this.manifestPath, "");
    return { restored, removed, errors };
  }
}

export function readControlConfig() {
  const file = path.join(APEX_DIR, "control.json");
  if (!fs.existsSync(file)) {
    return {
      fileRoots: defaultRoots(),
      plannerModel: "qwen3:4b",
      visionModel: "gemma3:4b",
      maxSteps: 20,
      autoApprove: false,
      vision: false,
    };
  }
  try {
    return { ...JSON.parse(fs.readFileSync(file, "utf8")), file: file };
  } catch {
    return {
      fileRoots: defaultRoots(),
      plannerModel: "qwen3:4b",
      visionModel: "gemma3:4b",
      maxSteps: 20,
      autoApprove: false,
      vision: false,
    };
  }
}

export function writeControlConfig(config) {
  fs.mkdirSync(APEX_DIR, { recursive: true });
  const file = path.join(APEX_DIR, "control.json");
  const payload = { ...config };
  delete payload.file;
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}
