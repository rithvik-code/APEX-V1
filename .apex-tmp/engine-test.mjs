import fs from "node:fs";
import { FileEngine } from "../cli/server/control/files.mjs";
import { runCommand } from "../cli/server/control/terminal.mjs";

const target = new URL("./engine-test.txt", import.meta.url).pathname.replace(/^\//, "");
const engine = new FileEngine({ roots: [process.cwd()], sessionId: "TEST-SESSION" });
const steps = {};

steps.write = engine.write(target, "alpha\nbeta\n");
steps.read = engine.read(target);
steps.replace = engine.replace(target, "beta", "gamma");
steps.readAfter = engine.read(target);
steps.undo = engine.undo();
steps.readRestored = engine.read(target);
steps.command = await runCommand('node -e "console.log(\'APEX_TERM_OK\')"', {
  cwd: process.cwd(),
});
try {
  await runCommand('format c: /q', { cwd: process.cwd() });
  steps.blocked = false;
} catch (error) {
  steps.blocked = error.message;
}
steps.deleted = fs.existsSync(target);
if (steps.deleted) fs.unlinkSync(target);
console.log(JSON.stringify(steps, null, 2));
