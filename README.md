# APEX — terminal intelligence

An Igloo Inc–inspired, scroll-driven 3D site for a terminal-native AI, plus a real
CLI that talks to a model running on your own machine.

Two pieces ship here:

| Piece | Where | What it is |
| --- | --- | --- |
| Site | `src/` | Vite + React + Three.js. Procedural supercar, wireframe superbike, light tunnel, HUD, live terminal. |
| CLI | `cli/` | `apex` — a streaming chat client for local Ollama. No account, no key, no meter. |

## Run the site

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # typecheck + production build
npm run preview      # serve the built site
```

The 3D world, preloader, cursor, HUD, chapter rail and audio toggle are all real.
Audio is off until you turn it on; the drone and ticks are synthesized with WebAudio,
so there are no audio files to download.

Two engine cutaways are built into the scene. **X-RAY THE V12 BITURBO** (in
MACHINE) and **X-RAY THE IN-LINE FOUR** (in VAST) open the CORE LAB: a full-screen
cutaway render with animated pistons, rods, cams, valves, timing gear and turbos,
plus a camera route that deliberately flies through the assembly. The car carries
a 6.5 L 60° V12 with twin turbos under a glass power dome; the bike carries a
998 cc in-line four with DOHC and 16 valves. Both are procedural geometry — no
models are downloaded.

The terminal section starts in **demo** mode with canned responses. If Ollama is
running on `127.0.0.1:11434`, the page detects it on load and links to it
automatically (the status line switches from `DEMO` to `LOCAL`). Use the **LINK**
button inside the terminal to change provider, endpoint, model, API key or the
system prompt. Settings live in `localStorage` on your machine.

For the browser terminal to reach Ollama on a non-localhost origin (for example a
deployed copy of the site), allow that origin in Ollama:

```bash
# macOS / Linux
OLLAMA_ORIGINS="https://your-site.example" ollama serve
# Windows PowerShell
$env:OLLAMA_ORIGINS="https://your-site.example"; ollama serve
```

## Run the CLI

Requires Node 18+ and [Ollama](https://ollama.com).

```bash
ollama pull qwen2.5:3b
npm install -g ./cli
apex
```

Then just talk to it:

```bash
apex                                    # interactive REPL
apex "write a retry helper in TypeScript"
cat server.log | apex "what failed here?"
apex models                             # local models
apex config                             # print config + path
apex config --set model=qwen3:4b
```

REPL commands: `/help`, `/do <task>`, `/model <name>`, `/prompt <text>`,
`/temp <n>`, `/models`, `/config`, `/clear`, `/demo`, `/live`, `/quit`.

### Agent mode

`apex do` hands the model your machine, the way a coding agent does. It runs a
tool loop until the task is finished: inspect, edit, run, read the result, repeat.

```bash
apex do "fix the failing tests and show me what changed"
apex do "add a health endpoint to the server and verify it"
apex do --yes "scaffold a Vite app in ./demo"      # skip per-action prompts
```

Tools: `list_dir`, `read_file`, `write_file`, `replace_in_file`, `run_command`.
The agent works in the directory you launched it from and reports every action.
By default each write and command asks `[y/N]` before it happens; `--yes` (or
`APEX_YES=1`) auto-approves for unattended runs. Commands time out after 180s
(`APEX_CMD_TIMEOUT` to change it) and output is clipped before it goes back to
the model. In the REPL, `/do <task>` runs one agent task and returns to chat.

It runs as a tool loop: plan a little, turn, tool call, read the result, repeat —
so a task that touches multiple files or needs a build/test to pass can actually
complete. On the machine it autonomous over: read and write files there, run shell
commands, chain several steps as long as each one clears its `[y/N]`.

Agent mode needs a live model — it does not run against the demo provider — and
an interactive terminal unless you pass `--yes`.

Config is created on first run at `~/.apex/config.json`:

```json
{
  "endpoint": "http://127.0.0.1:11434",
  "model": "qwen2.5:3b",
  "systemPrompt": "You are APEX, a terminal-native intelligence engine...",
  "temperature": 0.85
}
```

Streaming uses Ollama's `/api/chat`. If the daemon is down, `apex` prints the
endpoint, model and the exact commands to start it instead of a stack trace.

## On "free, unlimited, unrestricted"

- **Free and unlimited** because the model runs on your hardware. There is no API
  bill and no token meter. The ceiling is your GPU/CPU and context window.
- **No filters are added by APEX.** The CLI sends your system prompt exactly as
  written, with no moderation layer and no prompt rewriting. You control the
  persona and can change it at any time.
- **The model's own training still applies.** APEX cannot strip a model's built-in
  behavior, and different local models behave differently. If a model refuses
  something, that is the model, not APEX. Choose your model and prompt accordingly.
- **Agent mode actually acts.** `apex do` can create and edit files and run shell
  commands in the directory you started it from. The default build asks before
  every write and command; `--yes` turns those prompts off. There is no sandbox:
  when you approve a command it runs with your user account. Read the command
  before you approve it.
- **No filters are added, but the tools are real.** The model can propose a
  destructive command, and the approval prompt is the only gate in front of it.
  That is the trade: control without a middleman, plus a visible last look before
  anything lands.

## Layout

```
src/
  App.tsx              sections, chapters, install, footer
  styles.css           full visual system + responsive rules
  three/Engine.ts      scene, camera flight, labels, bloom, grain, tunnel
  three/car.ts         procedural supercar + cockpit + V12 bay
  three/bike.ts        wireframe superbike + in-line four
  three/engines.ts     V12 biturbo and I4 DOHC 16V cutaways, animated
  components/          Terminal, CoreLab, Preloader, Cursor
  lib/ai.ts            demo / Ollama / OpenAI-compatible streaming
  lib/sound.ts         synthesized ambience
cli/
  apex.mjs             the `apex` command
```

## Notes

- The camera flight is scroll-driven with keyframes and damped interpolation;
  `prefers-reduced-motion` disables the animated grain and reveal transitions.
- The site is not deployed. `npm run build` produces `dist/` for any static host.
- The bundle is ~835 kB (~230 kB gzipped) because Three.js is included; that is the
  cost of the 3D world, not a framework problem.
"# APEX-V1" 
