import { spawn } from "node:child_process";

const active = new Set();

export function psB64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runPowerShell(script, { timeoutMs = 30000, signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Control stopped", "AbortError"));
  }
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      { windowsHide: true },
    );
    active.add(child);

    let stdout = "";
    let stderr = "";
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
      child.kill();
      finish(reject, new DOMException("Control stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`PowerShell timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4_000_000) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (signal?.aborted) {
        finish(reject, new DOMException("Control stopped", "AbortError"));
        return;
      }
      if (code !== 0) {
        finish(
          reject,
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `PowerShell exited with code ${code}`,
          ),
        );
        return;
      }
      finish(resolve, stdout.trim());
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runPowerShellJson(script, options) {
  const output = await runPowerShell(script, options);
  const line = output.split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error("PowerShell returned no JSON");
  try {
    return JSON.parse(line);
  } catch {
    // Windows PowerShell 5.1 can leak raw control characters through
    // ConvertTo-Json; strip them and retry once.
    return JSON.parse(line.replace(/[\u0000-\u001f\u007f]/g, " "));
  }
}

export function killAllPowerShell() {
  for (const child of active) {
    try {
      child.kill();
    } catch {
      // The process already exited.
    }
  }
  active.clear();
}
