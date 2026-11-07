import {
  launchApp,
  listWindows,
  focusWindow,
  typeText,
  focusedValue,
  closeProcess,
} from "../cli/server/control/desktop.mjs";

const result = { steps: [] };
const app = await launchApp({ app: "notepad.exe" });
result.steps.push({ launch: app });
await new Promise((r) => setTimeout(r, 4000));
const windows = await listWindows();
const win = windows.find(
  (w) => /notepad/i.test(w.process) || /notepad/i.test(w.title),
);
result.steps.push({ windows: windows.map((w) => `${w.process}:${w.title}`), window: win ?? null });
if (!win) {
  console.log(JSON.stringify({ ok: false, reason: "No notepad window", result }, null, 2));
  process.exit(0);
}
const targetPid = win.pid;
const focus = await focusWindow(targetPid);
result.steps.push({ focus });
await new Promise((r) => setTimeout(r, 500));
const active = (await listWindows()).find((w) => w.active);
result.steps.push({ active });
if (!active || active.pid !== targetPid) {
  await closeProcess(targetPid);
  console.log(JSON.stringify({ ok: false, reason: "Notepad did not take focus", result }, null, 2));
  process.exit(0);
}
await typeText("APEX CONTROL SELF TEST");
await new Promise((r) => setTimeout(r, 700));
const value = await focusedValue();
result.steps.push({ value });
await closeProcess(targetPid);
const ok = String(value.value || "").includes("APEX CONTROL SELF TEST");
console.log(JSON.stringify({ ok, result }, null, 2));
