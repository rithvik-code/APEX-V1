import { spawn } from "node:child_process";

const active = new Set();

const BLOCKED = [
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bvssadmin\s+delete\b/i,
  /\bcipher\s+\/w\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bstop-computer\b/i,
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bdel\s+\/f\s+\/s\s+\/q\s+[a-z]:\\/i,
  /\brd\s+\/s\s+\/q\s+[a-z]:\\/i,
  /\bremove-item\b[^\n]*-recurse[^\n]*\b[a-z]:\\/i,
  /\breg\s+delete\s+hk(lm|ey_local_machine)/i,
  /\btakeown\s+\/f\s+[a-z]:\\/i,
  /\bicacls\s+[a-z]:\\\s+\/grant/i,
  /\bnet\s+user\b[^\n]*\/add/i,
  /\.apex\\(shadow|config|control)/i,
];

function killTree(pid) {
  try {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    // Process may have exited.
  }
}

export function runCommand(command, { cwd, timeoutMs = 120_000, signal } = {}) {
  const clean = String(command || "").trim();
  if (!clean) return Promise.reject(new Error("Command is empty"));
  const blocked = BLOCKED.find((pattern) => pattern.test(clean));
  if (blocked) {
    return Promise.reject(
      new Error("Blocked by the APEX safety manager: destructive system command"),
    );
  }
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Control stopped", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(clean, {
      shell: true,
      cwd: cwd || process.cwd(),
      windowsHide: true,
      env: { ...process.env, APEX_CONTROL: "1" },
    });
    active.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(child);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      killTree(child.pid);
      finish(reject, new DOMException("Control stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < 64_000) stdout += chunk.toString("utf8");
      else truncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64_000) stderr += chunk.toString("utf8");
      else truncated = true;
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      finish(resolve, {
        command: clean,
        code: code ?? -1,
        stdout,
        stderr,
        ms: Date.now() - started,
        timedOut,
        truncated,
      });
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function stopCommands() {
  for (const child of active) {
    if (child.pid) killTree(child.pid);
  }
  active.clear();
}
