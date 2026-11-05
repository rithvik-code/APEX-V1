```
  ▄▀█ █▀█ █▀▀ █ █
  █▀█ █▀▀ ██▄ █▀█   TERMINAL INTELLIGENCE
```

# apex — the CLI

Local, unmetered, direct. Chat and an agent loop against a model running on your own
hardware through [Ollama](https://ollama.com). No account, no key, no meter.

```bash
ollama pull qwen2.5:3b
npm install -g ./cli
apex
```

## Chat

```bash
apex                                        # interactive REPL
apex "write a retry helper in TypeScript"   # one shot
cat server.log | apex "what failed here?"   # pipe context in
apex models                                 # local models
apex config --set model=qwen3:4b
```

REPL: `/help` `/do` `/model` `/prompt` `/temp` `/tier` `/models` `/config` `/clear`
`/demo` `/live` `/quit`.

## Agent mode

```bash
apex do "fix the failing tests and show me what changed"
apex do --tier machine "…"
apex do --yes "…"
```

Tools: `list_dir` `read_file` `write_file` `replace_in_file` `run_command` `fetch_url`.

### Tiers

| Tier | Writes / runs |
| --- | --- |
| `read` | nothing — inspection only |
| `project` (default) | inside the directory you launched from |
| `machine` | anywhere, as your user |

### Undo

Every write is snapshotted to `~/.apex/shadow/<session>/` before it lands.

```bash
apex undo            # roll back the most recent run
apex undo --list     # all sessions
apex undo --dry-run  # preview only
```

The agent cannot write to `~/.apex/`, so it cannot delete its own rollback.

### Budgets

```bash
apex do --steps 12 --minutes 5 --ctx 32768 "…"
```

Repeated identical calls stop the loop rather than burning your GPU.

## Audit

`apex history` tails `~/.apex/actions.log` — tier, target, exit code, and whether you
approved each action.

## Config

`~/.apex/config.json` — `endpoint` `model` `systemPrompt` `temperature`
`agentTemperature` `numCtx` `tier` `maxSteps` `maxMinutes` `shadow`.

Env: `APEX_MODEL` `APEX_ENDPOINT` `APEX_SYSTEM_PROMPT` `APEX_YES=1`
`APEX_CMD_TIMEOUT` `NO_COLOR`.

## Honest limits

- APEX adds no moderation layer and rewrites nothing. Your system prompt is sent as
  written. The model's own training still applies — that is not APEX removing it.
- There is no sandbox. Anything you approve runs as you. Tier confines the file tools,
  not the shell.
- Fetched pages and read files are wrapped as untrusted data, but prompt injection is
  not solved by any prompt. Keep `shadow` on.
