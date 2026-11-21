import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_ENDPOINT } from "./planner.mjs";
import { chat } from "./planner.mjs";
import {
  ANSWER_SCHEMA,
  APEX_HOME,
  inventory,
  parseAnswer,
  readJson,
  resolveRole,
  timed,
  writeJson,
} from "./brain.mjs";
import { addNote } from "./memory.mjs";
import { readProjectFile, searchProject } from "./project.mjs";
import { look } from "./copilot.mjs";
import { runCrew } from "./crew.mjs";

/*
 * WORKFLOW STUDIO + TESTING BAY.
 *
 * A workflow is an ordered list of local steps with explicit inputs. It can be
 * previewed before it runs: the preview shows the resolved prompt for every
 * step, so nothing surprising happens on a real page. The testing bay runs the
 * same example prompt against several models and records time and output, so
 * tuning a prompt is measured rather than assumed.
 */

const WORKFLOW_FILE = path.join(APEX_HOME, "workflows.json");
const MAX_STEPS = 8;
const STEP_TYPES = new Set(["chat", "project_search", "file_read", "memory_save", "screen_look", "crew"]);

export const STEP_HELP = {
  chat: "Ask a local model. Use {{input}}, {{page}} or {{previous}} in the prompt.",
  project_search: "Search the APEX project index.",
  file_read: "Read a project file into the next step.",
  memory_save: "Save text into personal memory.",
  screen_look: "Capture the screen and ask the vision model.",
  crew: "Hand the brief to one garage crew specialist.",
};

export const DEFAULT_WORKFLOWS = [
  {
    id: "page-to-task",
    name: "PAGE → PROJECT TASK",
    summary: "Summarize a page, keep the key points, then draft an actionable project task.",
    steps: [
      {
        type: "chat",
        label: "Summarize the page",
        params: {
          prompt:
            "Summarize this page as factual bullets: the main claim, the concrete details, decisions, and open questions.\n\n{{page}}",
        },
      },
      {
        type: "memory_save",
        label: "Store the key points",
        params: { text: "{{previous}}", tags: "page-summary" },
      },
      {
        type: "chat",
        label: "Draft the task",
        params: {
          prompt:
            "Turn these notes into one actionable project task. Give it a title, a one-line goal, three acceptance checks, and any files or components it likely touches.\n\n{{previous}}",
        },
      },
    ],
  },
  {
    id: "screen-to-fix",
    name: "SCREEN → FIX",
    summary: "Look at what is on screen, find the code responsible, then propose the smallest fix.",
    steps: [
      {
        type: "screen_look",
        label: "Read the screen",
        params: { question: "What is on screen, and what looks broken or unfinished?" },
      },
      {
        type: "project_search",
        label: "Find the responsible code",
        params: { query: "{{previous}}", limit: 6 },
      },
      {
        type: "crew",
        label: "Code Mechanic proposes the fix",
        params: { agent: "code-mechanic", brief: "{{previous}}" },
      },
    ],
  },
  {
    id: "brief-to-build",
    name: "BRIEF → BUILD PLAN",
    summary: "Map the parts of APEX a new feature would touch, then write the build plan.",
    steps: [
      {
        type: "project_search",
        label: "Map the relevant code",
        params: { query: "{{input}}", limit: 8 },
      },
      {
        type: "crew",
        label: "File Librarian maps the surfaces",
        params: { agent: "file-librarian", brief: "{{input}}\n\nRelevant code found:\n{{previous}}" },
      },
      {
        type: "chat",
        label: "Write the plan",
        params: {
          prompt:
            "Write a short build plan from these findings: files to change, the order of work, and the check that proves each step works. No filler.\n\n{{previous}}",
        },
      },
    ],
  },
];

function readCustom() {
  const stored = readJson(WORKFLOW_FILE, { workflows: [] });
  if (!Array.isArray(stored.workflows)) return [];
  return stored.workflows.filter((entry) => entry && typeof entry.id === "string");
}

export function listWorkflows() {
  const custom = readCustom();
  const customIds = new Set(custom.map((item) => item.id));
  return [
    ...DEFAULT_WORKFLOWS.filter((item) => !customIds.has(item.id)).map((item) => ({
      ...item,
      builtin: true,
    })),
    ...custom.map((item) => ({ ...item, builtin: false })),
  ];
}

function validate(workflow) {
  if (!workflow || typeof workflow !== "object") throw new Error("A workflow is required");
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (!steps.length) throw new Error("A workflow needs at least one step");
  if (steps.length > MAX_STEPS) throw new Error(`A workflow is limited to ${MAX_STEPS} steps`);
  return steps.map((step, index) => {
    const type = String(step?.type || "");
    if (!STEP_TYPES.has(type)) throw new Error(`Step ${index + 1} has an unknown type: ${type || "(missing)"}`);
    const params = step?.params && typeof step.params === "object" ? step.params : {};
    return {
      type,
      label: String(step?.label || type).slice(0, 80),
      params: Object.fromEntries(
        Object.entries(params)
          .slice(0, 12)
          .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 4000) : value]),
      ),
    };
  });
}

export function saveWorkflow(workflow) {
  const steps = validate(workflow);
  const name = String(workflow.name || "UNTITLED WORKFLOW").slice(0, 80);
  const id = String(workflow.id || crypto.randomUUID()).slice(0, 60);
  const custom = readCustom().filter((entry) => entry.id !== id);
  custom.push({
    id,
    name,
    summary: String(workflow.summary || "").slice(0, 240),
    steps,
    savedAt: new Date().toISOString(),
  });
  writeJson(WORKFLOW_FILE, { version: 1, workflows: custom.slice(-40) });
  return custom[custom.length - 1];
}

export function deleteWorkflow(id) {
  const custom = readCustom();
  const next = custom.filter((entry) => entry.id !== id);
  writeJson(WORKFLOW_FILE, { version: 1, workflows: next });
  return { removed: custom.length - next.length };
}

function substitute(template, values) {
  return String(template ?? "").replace(/\{\{(input|page|previous|file)\}\}/gi, (_, key) => {
    const value = values[key.toLowerCase()];
    return typeof value === "string" ? value : "";
  });
}

function resolveStep(step, values) {
  const params = { ...step.params };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") params[key] = substitute(value, values);
  }
  return params;
}

/** Preview what each step would receive, without calling a model. */
export function previewWorkflow({ id, workflow, input = "", page = "" } = {}) {
  const source = workflow ?? listWorkflows().find((entry) => entry.id === id);
  if (!source) throw new Error("Unknown workflow");
  const steps = validate(source);
  const warnings = [];
  let previous = "";
  let file = "";
  const planned = steps.map((step, index) => {
    const values = { input, page, previous, file };
    const params = resolveStep(step, values);
    const used = [...JSON.stringify(step.params).matchAll(/\{\{(\w+)\}\}/g)].map((match) =>
      match[1].toLowerCase(),
    );
    const unknown = used.filter((name) => !["input", "page", "previous", "file"].includes(name));
    if (unknown.length) {
      warnings.push(`Step ${index + 1} uses an unknown placeholder: ${[...new Set(unknown)].join(", ")}`);
    }
    if (step.type === "chat" && !params.prompt?.trim()) {
      warnings.push(`Step ${index + 1} has an empty prompt`);
    }
    if (step.type === "chat" && /\{\{(input|page|previous)\}\}/i.test(step.params.prompt || "") && !params.prompt.trim()) {
      warnings.push(`Step ${index + 1} needs input or page text`);
    }
    if (step.type === "project_search" && !params.query?.trim()) {
      warnings.push(`Step ${index + 1} needs a search query (provide input or a previous step)`);
    }
    if (step.type === "file_read" && !params.path?.trim()) {
      warnings.push(`Step ${index + 1} needs a file path`);
    }
    if (step.type === "crew" && !params.brief?.trim()) {
      warnings.push(`Step ${index + 1} needs a brief`);
    }
    previous = `[output of step ${index + 1}: ${step.label}]`;
    if (step.type === "file_read") file = String(params.path || "");
    return {
      index: index + 1,
      type: step.type,
      label: step.label,
      params,
      needs: {
        input: /\{\{input\}\}/i.test(JSON.stringify(step.params)),
        page: /\{\{page\}\}/i.test(JSON.stringify(step.params)),
        previous: index > 0 && /\{\{previous\}\}/i.test(JSON.stringify(step.params)),
      },
    };
  });
  return {
    workflow: { id: source.id, name: source.name, summary: source.summary },
    steps: planned,
    warnings,
    ready: !warnings.some((warning) => warning.includes("needs")),
  };
}

async function chooseModel(models, requested, step) {
  if (requested) return String(requested).slice(0, 100);
  if (step.type === "screen_look") return resolveRole("vision", models);
  return resolveRole("balanced", models);
}

/**
 * Run a workflow. `confirm` must be true because later steps act on the output
 * of earlier ones and may write to memory or read the screen.
 */
export async function runWorkflow({ id, workflow, input = "", page = "", model = "", confirm = false } = {}) {
  if (confirm !== true) {
    return { needsConfirm: true, preview: previewWorkflow({ id, workflow, input, page }) };
  }
  const source = workflow ?? listWorkflows().find((entry) => entry.id === id);
  if (!source) throw new Error("Unknown workflow");
  const steps = validate(source);
  const models = await inventory(DEFAULT_ENDPOINT).catch(() => []);
  const trace = [];
  let previous = "";
  let file = "";
  const started = Date.now();

  for (const [index, step] of steps.entries()) {
    const params = resolveStep(step, { input, page, previous, file });
    const chosen = await chooseModel(models, model, step);
    const stepStart = Date.now();
    let output = "";
    let detail = "";
    try {
      switch (step.type) {
        case "chat": {
          const prompt = String(params.prompt || "").trim();
          if (!prompt) throw new Error("This step has an empty prompt");
          output = await timed(chosen, () =>
            chat({
              model: chosen,
              endpoint: DEFAULT_ENDPOINT,
              temperature: 0.35,
              numCtx: 8192,
              format: ANSWER_SCHEMA,
              think: false,
              timeoutMs: 180000,
              messages: [
                {
                  role: "system",
                  content:
                    "You are Cyrus running an APEX workflow step. Answer only what this step asks. Lead with the result. No preamble, no restating the prompt, no invented facts. APEX and Cyrus were made by K Rithvik.",
                },
                { role: "user", content: prompt.slice(0, 12000) },
              ],
            }),
          );
          output = parseAnswer(output);
          detail = `${chosen} · ${prompt.length} chars in`;
          break;
        }
        case "project_search": {
          const results = await searchProject(String(params.query || ""), Number(params.limit) || 6);
          output = results
            .map((result) => `[${result.id}] ${result.file}:${result.start}-${result.end}\n${result.snippet}`)
            .join("\n\n");
          detail = `${results.length} passages`;
          break;
        }
        case "file_read": {
          const fileResult = readProjectFile(String(params.path || ""), {
            maxChars: Math.min(24000, Number(params.maxChars) || 12000),
          });
          output = fileResult.text;
          file = fileResult.path;
          detail = `${fileResult.path} · ${fileResult.chars} chars`;
          break;
        }
        case "memory_save": {
          const note = addNote({
            text: String(params.text || previous || "").slice(0, 4000),
            tags: params.tags || "workflow",
            source: `workflow:${source.id}`,
          });
          output = `Saved memory note ${note.id}`;
          detail = note.tags.join(", ");
          break;
        }
        case "screen_look": {
          const seen = await look({ question: String(params.question || previous || ""), fresh: true });
          output = seen.answer;
          detail = `${seen.model} · ${seen.width}x${seen.height}`;
          break;
        }
        case "crew": {
          const result = await runCrew({
            agentId: String(params.agent || "code-mechanic"),
            brief: String(params.brief || previous || input || ""),
            model,
          });
          output = result.answer;
          detail = `${result.agent.name} · ${result.trace.length} tool call(s)`;
          break;
        }
        default:
          throw new Error(`Unknown step type ${step.type}`);
      }
      trace.push({
        index: index + 1,
        type: step.type,
        label: step.label,
        ms: Date.now() - stepStart,
        ok: true,
        output: output.slice(0, 6000),
        detail,
      });
      previous = output;
    } catch (error) {
      trace.push({
        index: index + 1,
        type: step.type,
        label: step.label,
        ms: Date.now() - stepStart,
        ok: false,
        output: "",
        detail: String(error?.message || "Step failed").slice(0, 400),
      });
      return {
        workflow: { id: source.id, name: source.name },
        ok: false,
        failedAt: index + 1,
        trace,
        totalMs: Date.now() - started,
      };
    }
  }

  return {
    workflow: { id: source.id, name: source.name },
    ok: true,
    answer: previous,
    trace,
    totalMs: Date.now() - started,
  };
}

/* -------------------------------------------------------------------------- */
/* TESTING BAY                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_PROMPTS = 5;
const MAX_MODELS = 3;

/**
 * Run the same example prompts against several models so a prompt or model
 * change can be compared on real tasks instead of vibes.
 */
export async function runEval({ prompts = [], models = [], systemPrompt = "", temperature = 0.3 } = {}) {
  const tasks = (Array.isArray(prompts) ? prompts : [])
    .map((prompt) => String(prompt || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PROMPTS);
  if (!tasks.length) throw new Error("Add at least one test prompt");
  const installed = await inventory(DEFAULT_ENDPOINT).catch(() => []);
  const chosen = (Array.isArray(models) ? models : [])
    .map((name) => String(name || "").trim())
    .filter((name) => installed.some((model) => model.name === name))
    .slice(0, MAX_MODELS);
  if (!chosen.length) {
    const fallback = resolveRole("balanced", installed);
    if (!fallback) throw new Error("No installed model is available for the test");
    chosen.push(fallback);
  }
  const runs = [];
  for (const model of chosen) {
    for (const prompt of tasks) {
      const started = Date.now();
      try {
        const answer = await timed(model, () =>
          chat({
            model,
            endpoint: DEFAULT_ENDPOINT,
            temperature,
            numCtx: 8192,
            format: ANSWER_SCHEMA,
            think: false,
            timeoutMs: 180000,
            messages: [
              {
                role: "system",
                content:
                  (systemPrompt || "You are Cyrus, the APEX assistant. Answer directly and briefly.") +
                  "\nAPEX and Cyrus were made by K Rithvik.",
              },
              { role: "user", content: prompt },
            ],
          }),
        );
        runs.push({
          model,
          prompt,
          ms: Date.now() - started,
          ok: true,
          answer: parseAnswer(answer).slice(0, 4000),
        });
      } catch (error) {
        runs.push({
          model,
          prompt,
          ms: Date.now() - started,
          ok: false,
          answer: "",
          error: String(error?.message || "Run failed").slice(0, 240),
        });
      }
    }
  }
  const byModel = chosen.map((model) => {
    const own = runs.filter((run) => run.model === model);
    const ok = own.filter((run) => run.ok);
    return {
      model,
      runs: own.length,
      failures: own.length - ok.length,
      medianMs: ok.length ? [...ok].sort((a, b) => a.ms - b.ms)[Math.floor(ok.length / 2)].ms : null,
      chars: ok.reduce((sum, run) => sum + run.answer.length, 0),
    };
  });
  return { runs, byModel, systemPrompt: Boolean(systemPrompt) };
}
