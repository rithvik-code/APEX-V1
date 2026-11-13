/*
 * Shared lazy loaders for the mesh's in-browser intelligence. Every model is
 * downloaded once, on an explicit user action, cached by the browser and then
 * runs fully on this machine — nothing is called, nothing leaves the loop.
 */

export type LoadEvent = {
  file: string;
  status: "download" | "progress" | "done" | "ready" | "error";
  pct: number;
};

export type ProgressSink = (event: LoadEvent) => void;

type TfProgress = {
  status: string;
  file?: string;
  progress?: number;
};

function forward(info: unknown, sink?: ProgressSink): void {
  if (!sink) return;
  const event = info as TfProgress;
  const file = (event.file ?? "model").split("/").pop() ?? "model";
  if (event.status === "progress") {
    sink({ file, status: "progress", pct: Math.max(0, Math.min(100, event.progress ?? 0)) });
  } else if (event.status === "done") {
    sink({ file, status: "done", pct: 100 });
  } else if (event.status === "initiate") {
    sink({ file, status: "download", pct: 0 });
  }
}

let libPromise: Promise<typeof import("@huggingface/transformers")> | null = null;

function lib(): Promise<typeof import("@huggingface/transformers")> {
  libPromise ??= import("@huggingface/transformers").then((mod) => {
    mod.env.allowLocalModels = false;
    return mod;
  });
  return libPromise;
}

/* -------------------------------------------------------------------------- */
/* Sentence embedder — all-MiniLM-L6-v2, 384-dim, cosine-ready vectors.        */
/* -------------------------------------------------------------------------- */

export type Embedder = {
  embed(texts: string[]): Promise<Float32Array[]>;
};

let embedPromise: Promise<Embedder> | null = null;

export function loadEmbedder(onEvent?: ProgressSink): Promise<Embedder> {
  embedPromise ??= (async () => {
    const mod = await lib();
    const extractor = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      progress_callback: (info: unknown) => forward(info, onEvent),
    });
    onEvent?.({ file: "all-MiniLM-L6-v2", status: "ready", pct: 100 });
    return {
      async embed(texts: string[]): Promise<Float32Array[]> {
        const out = await extractor(texts, { pooling: "mean", normalize: true });
        const dims = out.dims as number[];
        const width = dims[dims.length - 1] as number;
        const data = out.data as Float32Array;
        const rows: Float32Array[] = [];
        for (let i = 0; i < dims[0]; i++) {
          rows.push(data.slice(i * width, (i + 1) * width));
        }
        return rows;
      },
    };
  })();
  return embedPromise.catch((error: unknown) => {
    embedPromise = null;
    throw error;
  });
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/* -------------------------------------------------------------------------- */
/* Whisper — offline speech-to-text, whisper-tiny.en at 16 kHz.                */
/* -------------------------------------------------------------------------- */

export type Asr = {
  transcribe(pcm16k: Float32Array): Promise<string>;
};

let asrPromise: Promise<Asr> | null = null;

export function loadAsr(onEvent?: ProgressSink): Promise<Asr> {
  asrPromise ??= (async () => {
    const mod = await lib();
    const make = (model: string) =>
      mod.pipeline("automatic-speech-recognition", model, {
        progress_callback: (info: unknown) => forward(info, onEvent),
      });
    let asr: Awaited<ReturnType<typeof make>>;
    try {
      asr = await make("onnx-community/whisper-tiny.en");
    } catch {
      asr = await make("Xenova/whisper-tiny.en");
    }
    onEvent?.({ file: "whisper-tiny.en", status: "ready", pct: 100 });
    return {
      async transcribe(pcm: Float32Array): Promise<string> {
        const raw = (await asr(pcm, { chunk_length_s: 30, stride_length_s: 5 })) as unknown;
        const first = Array.isArray(raw) ? raw[0] : raw;
        const text = (first as { text?: string } | undefined)?.text ?? "";
        return text.trim();
      },
    };
  })();
  return asrPromise.catch((error: unknown) => {
    asrPromise = null;
    throw error;
  });
}

/* -------------------------------------------------------------------------- */
/* Microphone — hold-to-talk capture that yields 16 kHz mono PCM.              */
/* -------------------------------------------------------------------------- */

export type MicRecorder = {
  start(): Promise<void>;
  stop(): Promise<Float32Array>;
  level(): number;
  close(): void;
};

function to16k(input: AudioBuffer): Float32Array {
  const targetRate = 16000;
  if (input.sampleRate === targetRate) {
    const mono = new Float32Array(input.length);
    for (let c = 0; c < input.numberOfChannels; c++) {
      const data = input.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / input.numberOfChannels;
    }
    return mono;
  }
  const ratio = input.sampleRate / targetRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  const channels = input.numberOfChannels;
  for (let i = 0; i < length; i++) {
    const src = Math.min(input.length - 1, Math.floor(i * ratio));
    for (let c = 0; c < channels; c++) out[i] += input.getChannelData(c)[src] / channels;
  }
  return out;
}

export async function openMic(): Promise<MicRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  let recording = false;
  let level = 0;
  const meter = window.setInterval(() => {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    level = peak;
  }, 50);

  return {
    async start() {
      if (recording) return;
      chunks.length = 0;
      recorder.start();
      recording = true;
    },
    async stop() {
      if (!recording) return new Float32Array(0);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      recording = false;
      await stopped;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      return to16k(buffer);
    },
    level() {
      return recording ? level : 0;
    },
    close() {
      window.clearInterval(meter);
      for (const track of stream.getTracks()) track.stop();
      source.disconnect();
      void ctx.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* MediaPipe vision — hand landmarks, pose, selfie segmentation.               */
/* -------------------------------------------------------------------------- */

export type HandFrame = {
  hands: Array<{ points: Array<{ x: number; y: number; z: number }>; label: string }>;
};

const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";

export type VisionHandle = {
  detect(video: HTMLVideoElement, timestamp: number): HandFrame;
  close(): void;
};

export async function loadHands(onEvent?: ProgressSink): Promise<VisionHandle> {
  onEvent?.({ file: "mediapipe vision runtime", status: "download", pct: 15 });
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM);
  onEvent?.({ file: "vision runtime", status: "done", pct: 45 });
  onEvent?.({ file: "hand_landmarker.task", status: "download", pct: 55 });
  const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  onEvent?.({ file: "hand_landmarker.task", status: "ready", pct: 100 });
  return {
    detect(video, timestamp) {
      const result = landmarker.detectForVideo(video, timestamp);
      const hands = (result.landmarks ?? []).map((points, index) => ({
        points,
        label: result.handedness?.[index]?.[0]?.categoryName ?? "?",
      }));
      return { hands };
    },
    close() {
      landmarker.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Pose — full-body landmarks (33 points) for the POSE COACH.                  */
/* -------------------------------------------------------------------------- */

export type PoseHandle = {
  detect(video: HTMLVideoElement, timestamp: number): Array<Array<{ x: number; y: number; z: number }>>;
  close(): void;
};

export async function loadPose(onEvent?: ProgressSink): Promise<PoseHandle> {
  onEvent?.({ file: "pose_landmarker.task", status: "download", pct: 20 });
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM);
  const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  onEvent?.({ file: "pose_landmarker.task", status: "ready", pct: 100 });
  return {
    detect(video, timestamp) {
      const result = landmarker.detectForVideo(video, timestamp);
      return result.landmarks ?? [];
    },
    close() {
      landmarker.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Depth anything — monocular depth for the DEPTH CAM node.                    */
/* -------------------------------------------------------------------------- */

export type DepthHandle = {
  estimate(imageUrl: string): Promise<{ data: Float32Array; width: number; height: number }>;
};

let depthPromise: Promise<DepthHandle> | null = null;

export function loadDepth(onEvent?: ProgressSink): Promise<DepthHandle> {
  depthPromise ??= (async () => {
    const mod = await lib();
    const estimator = await mod.pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", {
      progress_callback: (info: unknown) => forward(info, onEvent),
    });
    onEvent?.({ file: "depth-anything-v2-small", status: "ready", pct: 100 });
    return {
      async estimate(imageUrl: string) {
        const out = (await estimator(imageUrl)) as {
          predicted_depth: { data: Float32Array; dims: number[] };
        };
        const [ , height, width ] = out.predicted_depth.dims;
        return { data: out.predicted_depth.data, width, height };
      },
    };
  })();
  return depthPromise.catch((error: unknown) => {
    depthPromise = null;
    throw error;
  });
}

/* -------------------------------------------------------------------------- */
/* Named entities — BERT-NER for the DOSSIER PARSER.                           */
/* -------------------------------------------------------------------------- */

export type Entity = { word: string; entity: string; score: number };

export type NerHandle = {
  scan(text: string): Promise<Entity[]>;
};

let nerPromise: Promise<NerHandle> | null = null;

export function loadNer(onEvent?: ProgressSink): Promise<NerHandle> {
  nerPromise ??= (async () => {
    const mod = await lib();
    const ner = await mod.pipeline("token-classification", "Xenova/bert-base-NER", {
      progress_callback: (info: unknown) => forward(info, onEvent),
    });
    onEvent?.({ file: "bert-base-NER", status: "ready", pct: 100 });
    return {
      async scan(text: string): Promise<Entity[]> {
        const raw = (await ner(text, { aggregation_strategy: "simple" })) as Array<{
          word: string;
          entity_group?: string;
          score: number;
        }>;
        return raw.map((entry) => ({
          word: entry.word,
          entity: entry.entity_group ?? "?",
          score: entry.score,
        }));
      },
    };
  })();
  return nerPromise.catch((error: unknown) => {
    nerPromise = null;
    throw error;
  });
}

/* -------------------------------------------------------------------------- */
/* Object detection — YOLOs-tiny, 80 COCO classes.                             */
/* -------------------------------------------------------------------------- */

export type Detection = {
  label: string;
  score: number;
  box: [number, number, number, number];
};

export type DetectorHandle = {
  detect(imageUrl: string): Promise<Detection[]>;
};

let detectorPromise: Promise<DetectorHandle> | null = null;

export function loadDetector(onEvent?: ProgressSink): Promise<DetectorHandle> {
  detectorPromise ??= (async () => {
    const mod = await lib();
    const detector = await mod.pipeline("object-detection", "Xenova/yolos-tiny", {
      progress_callback: (info: unknown) => forward(info, onEvent),
    });
    onEvent?.({ file: "yolos-tiny", status: "ready", pct: 100 });
    return {
      async detect(imageUrl: string) {
        const raw = (await detector(imageUrl, { threshold: 0.55 })) as Array<{
          label: string;
          score: number;
          box: { xmin: number; ymin: number; xmax: number; ymax: number };
        }>;
        return raw.map((entry) => ({
          label: entry.label,
          score: entry.score,
          box: [entry.box.xmin, entry.box.ymin, entry.box.xmax, entry.box.ymax] as [
            number,
            number,
            number,
            number,
          ],
        }));
      },
    };
  })();
  return detectorPromise.catch((error: unknown) => {
    detectorPromise = null;
    throw error;
  });
}
