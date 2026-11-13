import type { MeshNodeProps } from "./types";

export type { MeshNodeProps };

export type NodeTier = "live" | "link" | "consent";

export type MeshNode = {
  id: string;
  code: string;
  name: string;
  tag: string;
  blurb: string;
  runtime: string;
  cost: string;
  tier: NodeTier;
  ring: number;
  phase: number;
  speed: number;
};

export const TIER_LABEL: Record<NodeTier, string> = {
  live: "RUNS NOW · IN-BROWSER",
  link: "LOCAL SERVICE LINK",
  consent: "OPEN WEIGHTS · ON YOUR CALL",
};

export const NODES: MeshNode[] = [
  {
    id: "whisper",
    code: "N-01",
    name: "WHISPER EAR",
    tag: "Offline speech-to-text",
    blurb:
      "A Whisper transformer compiled to WebAssembly listens on your mic and writes text in real time — with the network cable pulled out. Hold to talk, release to read. The model (~40 MB) downloads once into your browser cache and never phones home.",
    runtime: "TRANSFORMERS.JS · WASM SIMD",
    cost: "~40 MB CACHE",
    tier: "live",
    ring: 0,
    phase: 0.0,
    speed: 0.10,
  },
  {
    id: "memory",
    code: "N-02",
    name: "MESH MEMORY",
    tag: "Semantic recall over the knowledge base",
    blurb:
      "Every fact the machine has learned from live sources is embedded into a 384-dimensional memory lattice. Ask in plain language and the nearest memories surface by meaning, not keywords — a local RAG brain with zero servers.",
    runtime: "MINILM-L6 · 384-D VECTORS",
    cost: "~25 MB CACHE",
    tier: "live",
    ring: 0,
    phase: 0.6,
    speed: 0.1,
  },
  {
    id: "grid",
    code: "N-03",
    name: "SEMANTIC GRID",
    tag: "A map of everything the machine knows",
    blurb:
      "The whole knowledge base projected into a two-dimensional constellation, clustered by meaning. Facts that think alike sit together. Hover to inspect a star; the map rebuilds itself as the machine learns.",
    runtime: "MINILM-L6 · K-MEANS LATTICE",
    cost: "SHARES N-02 MODEL",
    tier: "live",
    ring: 0,
    phase: 1.2,
    speed: 0.1,
  },
  {
    id: "gesture",
    code: "N-04",
    name: "GESTURE DECK",
    tag: "Your hands, the remote control",
    blurb:
      "A hand-tracking vision model reads your webcam at video rate and turns gestures into machine actions. Pinch to pull the exploded view apart, open your palm to snap it home, spread two hands to raise the wind tunnel.",
    runtime: "MEDIAPIPE HANDS · WEBGL",
    cost: "~8 MB CACHE",
    tier: "live",
    ring: 0,
    phase: 1.8,
    speed: 0.1,
  },
  {
    id: "status",
    code: "N-05",
    name: "MESH STATUS",
    tag: "Real probes of your local services",
    blurb:
      "The mesh reaches out across loopback and reports what is actually running on this machine — Ollama, image services, the control daemon, your knowledge base. Green means a live socket answered. No theatre.",
    runtime: "LOOPBACK PROBES · FETCH",
    cost: "FREE",
    tier: "live",
    ring: 0,
    phase: 2.4,
    speed: 0.1,
  },
  {
    id: "pitnet",
    code: "N-06",
    name: "PIT NET",
    tag: "A neural net that learns your engine",
    blurb:
      "A tiny multilayer perceptron is trained live, in front of you, on samples from the dyno's V12 power band — it never sees the formula, only observations. Watch loss fall, then interrogate the learned brain with a throttle slider.",
    runtime: "PLAIN-TS MLP · 1-16-16-2",
    cost: "FREE",
    tier: "live",
    ring: 1,
    phase: 0.3,
    speed: -0.07,
  },
  {
    id: "command",
    code: "N-07",
    name: "COMMAND DECK",
    tag: "Voice in, real actions out",
    blurb:
      "Whisper hears the words; an intent grammar maps them to real controls — wind, rain, night mode, the exploded view, launch drive. Speak and the machine obeys, entirely offline.",
    runtime: "WHISPER + INTENT GRAMMAR",
    cost: "SHARES N-01 MODEL",
    tier: "live",
    ring: 1,
    phase: 0.9,
    speed: -0.07,
  },
  {
    id: "convoy",
    code: "N-08",
    name: "MULTI-AGENT CONVOY",
    tag: "Three minds, one question",
    blurb:
      "When a local Ollama daemon answers, the convoy splits your question across three agents — strategist, skeptic, engineer — streaming their takes in parallel columns. When it is offline, the convoy says so. Honestly.",
    runtime: "OLLAMA · PARALLEL STREAMS",
    cost: "YOUR LOCAL MODELS",
    tier: "live",
    ring: 1,
    phase: 1.5,
    speed: -0.07,
  },
  {
    id: "engineer",
    code: "N-09",
    name: "RACE ENGINEER CORE",
    tag: "The terminal's brain, on the mesh",
    blurb:
      "The full race-engineer intelligence — setup talk, telemetry reads, career calls — exposed as a mesh node. It lights up the moment an Ollama daemon answers on loopback; the terminal in section 03 already speaks to it.",
    runtime: "OLLAMA · 127.0.0.1:11434",
    cost: "YOUR LOCAL MODELS",
    tier: "link",
    ring: 1,
    phase: 2.1,
    speed: -0.07,
  },
  {
    id: "livery",
    code: "N-10",
    name: "LIVERY FORGE",
    tag: "Text-to-paint via Stable Diffusion",
    blurb:
      "Point the mesh at a local Stable Diffusion WebUI on port 7860 and describe a livery — the forge renders it and wraps it around the car. Weights stay on your disk; renders stay on your screen.",
    runtime: "SD WEBUI API · :7860",
    cost: "SD WEIGHTS · YOUR DISK",
    tier: "link",
    ring: 1,
    phase: 2.7,
    speed: -0.07,
  },
  {
    id: "rawlink",
    code: "N-11",
    name: "RAW LINK",
    tag: "llama.cpp server, raw socket",
    blurb:
      "A llama.cpp server on port 8080 is the purist's route: one GGUF, one socket, no framework. The mesh probes it and, if it answers, routes overflow inference to it.",
    runtime: "LLAMA.CPP · :8080",
    cost: "GGUF · YOUR DISK",
    tier: "link",
    ring: 2,
    phase: 0.15,
    speed: 0.045,
  },
  {
    id: "voiceforge",
    code: "N-12",
    name: "VOICE FORGE",
    tag: "Piper neural TTS on loopback",
    blurb:
      "A Piper text-to-speech daemon gives the radio co-driver a human voice, offline, in milliseconds per sentence. The node stands by until a Piper service answers on port 5000.",
    runtime: "PIPER HTTP · :5000",
    cost: "VOICE MODELS · YOUR DISK",
    tier: "link",
    ring: 2,
    phase: 0.75,
    speed: 0.045,
  },
  {
    id: "restore",
    code: "N-13",
    name: "RESTORE BAY",
    tag: "Real-ESRGAN upscaling",
    blurb:
      "Old screenshots, stretched exports, frozen replays — the restore bay runs them through Real-ESRGAN on your GPU and hands back 4× frames. Stands by for a local upscale service.",
    runtime: "REAL-ESRGAN SERVICE",
    cost: "GAN WEIGHTS · YOUR DISK",
    tier: "link",
    ring: 2,
    phase: 1.35,
    speed: 0.045,
  },
  {
    id: "stretch",
    code: "N-14",
    name: "TIME STRETCH",
    tag: "RIFE frame interpolation",
    blurb:
      "Real-Time Intermediate Flow estimation doubles the replay's frame rate — 30 fps exports become 60, 60 become 120, slo-mo straight out of a film. Waits for a local RIFE service to answer.",
    runtime: "RIFE SERVICE",
    cost: "FLOW WEIGHTS · YOUR DISK",
    tier: "link",
    ring: 2,
    phase: 1.95,
    speed: 0.045,
  },
  {
    id: "stems",
    code: "N-15",
    name: "RADIO STEMS",
    tag: "Demucs source separation",
    blurb:
      "Feed the race radio through Demucs and pull the voice out of the engine noise — or strip any track into stems on your own machine. The node listens for a local separation service.",
    runtime: "DEMUCS SERVICE",
    cost: "HYBRID TRANSFORMER · YOUR DISK",
    tier: "link",
    ring: 2,
    phase: 2.55,
    speed: 0.045,
  },
  {
    id: "brain",
    code: "N-16",
    name: "BROWSER BRAIN",
    tag: "A full LLM, no install at all",
    blurb:
      "WebGPU runs a quantized Llama or Qwen directly inside this tab — a genuine language model with no daemon, no Docker, no terminal. The first click asks your permission to fetch the weights; after that it is yours, offline.",
    runtime: "WEBLLM · WEBGPU",
    cost: "~0.5-1 GB CACHE",
    tier: "consent",
    ring: 2,
    phase: 3.15,
    speed: 0.045,
  },
  {
    id: "vision",
    code: "N-17",
    name: "VISION PIT",
    tag: "Object detection on anything you show it",
    blurb:
      "A YOLO-class detector compiled for the browser scans a camera frame or a dropped image and boxes what it sees — cars, people, cups of coffee. Forty megabytes, one click, zero servers.",
    runtime: "YOLOS-TINY · WASM",
    cost: "~25 MB CACHE",
    tier: "consent",
    ring: 2,
    phase: 3.75,
    speed: 0.045,
  },
  {
    id: "pose",
    code: "N-18",
    name: "POSE COACH",
    tag: "Full-body skeleton tracking",
    blurb:
      "Thirty-three keypoints per body, tracked from the webcam in real time — the same engine family as the gesture deck, whole-body. Motion energy drives the readouts; your driving position gets scored.",
    runtime: "MEDIAPIPE POSE · WEBGL",
    cost: "~10 MB CACHE",
    tier: "consent",
    ring: 2,
    phase: 4.35,
    speed: 0.045,
  },
  {
    id: "depth",
    code: "N-19",
    name: "DEPTH CAM",
    tag: "Monocular depth, movie grade",
    blurb:
      "Depth Anything reads a single frame and guesses the distance of every pixel — the film-grade depth pass, live in your browser. Show it the car; watch the bay turn into a volumetric map.",
    runtime: "DEPTH ANYTHING V2 · WASM",
    cost: "~100 MB CACHE",
    tier: "consent",
    ring: 2,
    phase: 4.95,
    speed: 0.045,
  },
  {
    id: "parser",
    code: "N-20",
    name: "DOSSIER PARSER",
    tag: "Entities, extracted from memory",
    blurb:
      "A named-entity model sweeps the entire knowledge base and pulls out people, teams, and places — then links them into a dossier graph. The machine's memory, organized by a second machine.",
    runtime: "BERT-NER · WASM",
    cost: "~110 MB CACHE",
    tier: "consent",
    ring: 2,
    phase: 5.55,
    speed: 0.045,
  },
];
