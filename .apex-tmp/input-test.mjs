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
await new Promise((r) => setTimeout(r, 2200));
const windows = await listWindows();
const win = windows.find((w) => w.pid === app.pid);
result.steps.push({ window: win ?? null });
if (!win) {
  await closeProcess(app.pid);
  console.log(JSON.stringify({ ok: false, reason: "No notepad window", result }, null, 2));
  process.exit(0);
}
const focus = await focusWindow(app.pid);
result.steps.push({ focus });
await new Promise((r) => setTimeout(r, 500));
const active = (await listWindows()).find((w) => w.active);
result.steps.push({ active });
if (!active || active.pid !== app.pid) {
  await closeProcess(app.pid);
  console.log(JSON.stringify({ ok: false, reason: "Notepad did not take focus", result }, null, 2));
  process.exit(0);
}
await typeText("APEX CONTROL SELF TEST");
await new Promise((r) => setTimeout(r, 700));
const value = await focusedValue();
result.steps.push({ value });
await closeProcess(app.pid);
const ok = String(value.value || "").includes("APEX CONTROL SELF TEST");
console.log(JSON.stringify({ ok, result }, null, 2));
