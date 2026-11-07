import { planNext } from "../cli/server/control/planner.mjs";

const permissions = {
  screen: true,
  accessibility: true,
  mouse: false,
  keyboard: false,
  apps: false,
  browser: false,
  files: true,
  terminal: false,
};

const observation = `SCREEN: 1920x1200
ACTIVE WINDOW: Qoder (pid 4242) "APEX — Qoder"
FOCUSED: editor "Takeover.tsx"
WINDOWS: Qoder, PowerShell, Chrome
NOTE: This is the user's development laptop.`;
const fileResult =
  'File C:\\Users\\Rithvik\\OneDrive\\Documents\\FUN\\package.json (763 bytes)\n---\n{\n  "name": "apex-terminal",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module"\n}';

const cases = [
  {
    label: "single successful read",
    history: [
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
    ],
  },
  {
    label: "read repeated twice (was looping)",
    history: [
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
    ],
  },
  {
    label: "read repeated three times",
    history: [
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
      { action: "file_read", args: { path: "package.json" }, result: fileResult },
    ],
  },
];

for (const item of cases) {
  const started = Date.now();
  try {
    const decision = await planNext({
      goal: "Use file_read to read package.json in this repository and report the name field in the done summary. Do not modify anything.",
      observation,
      history: item.history,
      permissions,
      model: "qwen2.5:3b",
      step: item.history.length,
      maxSteps: 20,
    });
    console.log(
      JSON.stringify(
        {
          case: item.label,
          ms: Date.now() - started,
          action: decision.action,
          args: decision.args,
          thought: decision.thought,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(JSON.stringify({ case: item.label, ms: Date.now() - started, error: error.message }, null, 2));
  }
}
