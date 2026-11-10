import type { SceneConfig } from "./scene";

/* -------------------------------------------------------------------------- */
/* Ghost laps — a recorded camera flight plus the setup it was captured with.  */
/* -------------------------------------------------------------------------- */

export type CameraSample = {
  t: number;
  pos: [number, number, number];
  tgt: [number, number, number];
  fov: number;
};

export type LapRecording = {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  samples: CameraSample[];
  config: SceneConfig;
};

const LAP_KEY = "apex.laps.v1";
const LAP_LIMIT = 8;

export function loadLaps(): LapRecording[] {
  try {
    const raw = localStorage.getItem(LAP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LapRecording[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (lap) => lap && typeof lap.id === "string" && Array.isArray(lap.samples),
    );
  } catch {
    return [];
  }
}

function persistLaps(laps: LapRecording[]): void {
  try {
    localStorage.setItem(LAP_KEY, JSON.stringify(laps));
  } catch {
    // Private contexts can block storage; the session still works.
  }
}

export function saveLap(lap: LapRecording): LapRecording[] {
  const next = [lap, ...loadLaps()].slice(0, LAP_LIMIT);
  persistLaps(next);
  return next;
}

export function removeLap(id: string): LapRecording[] {
  const next = loadLaps().filter((lap) => lap.id !== id);
  persistLaps(next);
  return next;
}

export function newLapId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Linear interpolation between the two samples bracketing a point in time.
export function sampleLap(
  lap: LapRecording,
  time: number,
): { pos: [number, number, number]; tgt: [number, number, number]; fov: number } {
  const samples = lap.samples;
  if (!samples.length) {
    return { pos: [7.4, 2, 9.2], tgt: [0, 0.62, 0], fov: 40 };
  }
  const t = Math.min(lap.duration, Math.max(0, time));
  let i = 0;
  while (i < samples.length - 2 && samples[i + 1].t < t) i++;
  const a = samples[i];
  const b = samples[Math.min(samples.length - 1, i + 1)];
  const span = Math.max(1e-4, b.t - a.t);
  const k = Math.min(1, Math.max(0, (t - a.t) / span));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    pos: [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), mix(a.pos[2], b.pos[2])],
    tgt: [mix(a.tgt[0], b.tgt[0]), mix(a.tgt[1], b.tgt[1]), mix(a.tgt[2], b.tgt[2])],
    fov: mix(a.fov, b.fov),
  };
}

/* -------------------------------------------------------------------------- */
/* Cinematic clip export — viewport + burned-in telemetry to a WebM file.      */
/* -------------------------------------------------------------------------- */

export class ClipRecorder {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private provider: () => string[];
  private startedAt = 0;
  readonly mime: string;

  constructor(source: HTMLCanvasElement, provider: () => string[]) {
    this.provider = provider;
    this.canvas = document.createElement("canvas");
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    this.ctx = this.canvas.getContext("2d")!;
    const stream = this.canvas.captureStream(30);
    this.mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mime,
      videoBitsPerSecond: 8_000_000,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
  }

  start(): void {
    this.startedAt = performance.now();
    this.recorder.start(100);
  }

  // Called by the engine immediately after it renders, so the WebGL back buffer
  // is still valid when copied into the composite canvas.
  frame(source: HTMLCanvasElement): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(source, 0, 0, w, h);

    const scale = w / 1280;
    const lines = this.provider();
    const pad = 28 * scale;
    const lineH = 26 * scale;
    const boxH = pad * 1.4 + lines.length * lineH;
    ctx.fillStyle = "rgba(5,6,7,0.72)";
    ctx.fillRect(pad, h - boxH - pad, 460 * scale, boxH);
    ctx.strokeStyle = "rgba(200,255,22,0.4)";
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeRect(pad, h - boxH - pad, 460 * scale, boxH);

    const elapsed = (performance.now() - this.startedAt) / 1000;
    const tc = `REC ● ${elapsed.toFixed(1)}s`;
    ctx.font = `700 ${18 * scale}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = "#c8ff16";
    ctx.textBaseline = "top";
    ctx.fillText(tc, pad * 1.5, h - boxH - pad + pad * 0.5);

    ctx.font = `${15 * scale}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = "#e9ede8";
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        pad * 1.5,
        h - boxH - pad + pad * 0.5 + (index + 1) * lineH,
      );
    });
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: this.mime }));
      if (this.recorder.state !== "inactive") this.recorder.stop();
      else resolve(new Blob(this.chunks, { type: this.mime }));
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}