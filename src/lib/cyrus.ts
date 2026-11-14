import { useSyncExternalStore } from "react";
import {
  listOllamaModels,
  loadSettings,
  pickBestModel,
  streamChat,
  type AiSettings,
  type ChatMessage,
} from "./ai";
import { needsGrounding, retrieveGrounding, type Grounding } from "./web";
import { knowledgeContext } from "./knowledge";

/* CYRUS — the garage's always-listening voice intelligence. Wake word, intent
 * routing, spoken replies. Chrome's continuous Web Speech recogniser gives the
 * Siri-like latency; where it is missing or blocked, an offline Whisper ear
 * with voice-activity detection takes over. */

export type CyrusPhase = "off" | "starting" | "standby" | "awake" | "thinking" | "speaking";
export type CyrusEar = "web-speech" | "whisper" | null;
export type CyrusLine = { who: "you" | "cyrus"; text: string };

export type CyrusSnapshot = {
  phase: CyrusPhase;
  ear: CyrusEar;
  heard: string;
  reply: string;
  status: string;
  error: string | null;
  log: CyrusLine[];
};

export type CyrusIntent =
  | { kind: "pet"; pet: "dog" | "cat" | "turtles" }
  | { kind: "drive"; vehicle: "car" | "bike" }
  | { kind: "garage" }
  | { kind: "exit" }
  | { kind: "door"; open: boolean | null }
  | { kind: "lift"; up: boolean | null }
  | { kind: "service"; on: boolean | null }
  | { kind: "panel"; panel: "shelf" | "computer" | "trophies" | "launch" }
  | { kind: "photo" }
  | { kind: "rev"; vehicle: "car" | "bike" }
  | { kind: "sit" }
  | { kind: "music"; on: boolean }
  | { kind: "weather"; rain: boolean | null; night: boolean | null }
  | { kind: "sound"; on: boolean }
  | { kind: "replay" }
  | { kind: "restart" }
  | { kind: "recover" }
  | { kind: "line"; on: boolean | null }
  | { kind: "ghost"; on: boolean | null }
  | { kind: "bestLap" }
  | { kind: "status" }
  | { kind: "time" }
  | { kind: "date" }
  | { kind: "greet" }
  | { kind: "help" }
  | { kind: "thanks" }
  | { kind: "stop" }
  | { kind: "sleep" }
  | { kind: "off" }
  | { kind: "ask"; text: string };

/** Returns the line CYRUS speaks, or null when the action is unavailable here. */
export type CyrusHandler = (intent: CyrusIntent) => string | null;

/* -------------------------------------------------------------------------- */
/* Wake word + intent parsing                                                  */
/* -------------------------------------------------------------------------- */

// Recognisers rarely spell an unusual name the same way twice; these are the
// spellings Chrome and whisper-tiny actually produce for "hey cyrus".
const WAKE =
  /\b(?:(?:hey|hi|hello|ok|okay|yo|a)[\s,]+)?(?:cyrus|cyrus's|cirrus|sirus|sirius|syrus|cyris|ciros|cyprus|siris|sire us|siri us|sigh rus|sy rus|cy rus)\b|\b(?:hey|hi|okay|ok)[\s,]+(?:serious|virus|iris|sirus|cyrus)\b/i;

export function splitWake(text: string): { woke: boolean; rest: string } {
  const match = WAKE.exec(text);
  if (!match) return { woke: false, rest: text.trim() };
  const rest = text
    .slice(match.index + match[0].length)
    .replace(/^[\s,.!?;:-]+/, "")
    .trim();
  return { woke: true, rest };
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseIntent(raw: string): CyrusIntent {
  const t = norm(raw);
  const words = t ? t.split(" ").length : 0;
  const on = (yes: RegExp, no: RegExp): boolean | null =>
    no.test(t) ? false : yes.test(t) ? true : null;

  if (/^(?:ok |okay )?(?:stop|cancel|never ?mind|shut up|quiet|be quiet|silence|enough|thats enough)\b/.test(t))
    return { kind: "stop" };
  if (/\b(stop listening|turn yourself off|mic off|microphone off|shut down|power down)\b/.test(t))
    return { kind: "off" };
  if (/\b(go to sleep|goodbye|good bye|bye bye|good night|thats all|sleep now)\b/.test(t) || t === "bye")
    return { kind: "sleep" };
  if (/\b(thank you|thanks|cheers|nice one|good job|well done)\b/.test(t) && words <= 5)
    return { kind: "thanks" };

  if (/\b(scotch|scotty|scottie|scott|scot|doggo|doggy|puppy|the dog|my dog|good boy)\b/.test(t))
    return { kind: "pet", pet: "dog" };
  if (/\b(mario|the cat|my cat|kitty|kitten)\b/.test(t)) return { kind: "pet", pet: "cat" };
  if (/\bturtles?\b/.test(t)) return { kind: "pet", pet: "turtles" };

  if (/\b(door|shutter|roller)\b/.test(t))
    return { kind: "door", open: on(/\b(open|up|raise|lift)\b/, /\b(close|shut|down|lower)\b/) };
  if (/\bservice\b/.test(t))
    return { kind: "service", on: on(/\b(on|start|enter|enable|begin)\b/, /\b(off|end|stop|exit|disable|leave)\b/) };
  if (/\b(lift|hoist)\b/.test(t) || /\b(raise|lower)\b.*\bcar\b/.test(t))
    return { kind: "lift", up: on(/\b(up|raise|higher|lift the car|lift it)\b/, /\b(down|lower|drop)\b/) };

  const bike = /\b(bike|motorbike|motorcycle|h2r|kawasaki)\b/.test(t);
  if (/\b(rev|revs|rev it|rev up|fire up|fire it up|start the engine|engine)\b/.test(t))
    return { kind: "rev", vehicle: bike ? "bike" : "car" };

  if (/\b(photo|picture|snapshot|screenshot|pic|selfie)\b/.test(t)) return { kind: "photo" };

  if (
    /\b(back to|go to|take me to|return to|head to|open|enter|go back to|show me)\b.*\b(garage|bay)\b/.test(t) ||
    /\b(take me home|go home|pit in|box box|back to base)\b/.test(t)
  )
    return { kind: "garage" };

  if (
    (/\b(take|drive|grab|get in|hop in|jump in|lets go|go for|race|ride|hit the|head out|go out|go to the|start a)\b/.test(t) &&
      /\b(car|bike|motorbike|motorcycle|track|circuit|lap|laps|spin|drive|ride|race|road)\b/.test(t)) ||
    /^(lets (go|drive|race|ride|roll)|drive|race)\b/.test(t)
  )
    return { kind: "drive", vehicle: bike ? "bike" : "car" };

  if (/^(exit|leave|quit|get out|back out)\b|\b(leave|exit|quit)( the)? (garage|bay|drive|track|game)\b|\bstop driving\b/.test(t))
    return { kind: "exit" };

  if (/\b(recover|respawn|unstick|stuck|flip me|back on (the )?track)\b/.test(t)) return { kind: "recover" };
  if (/\b(restart|reset|start over|new lap)\b/.test(t)) return { kind: "restart" };
  if (/\b(racing line|the line|co ?pilot|assist|driving line|suggested line)\b/.test(t))
    return { kind: "line", on: on(/\b(on|show|enable|start)\b/, /\b(off|hide|disable|stop|remove)\b/) };
  if (/\bghost\b/.test(t))
    return { kind: "ghost", on: on(/\b(on|show|enable|race)\b/, /\b(off|hide|disable|remove)\b/) };
  if (/\b(best|fastest|personal best|pb|record|top)\b.*\b(lap|laps|time|times)\b|\blap (record|time)s?\b|\bleaderboard\b/.test(t))
    return { kind: "bestLap" };

  if (/\b(die ?cast|diecast|shelf|collection|model cars)\b/.test(t)) return { kind: "panel", panel: "shelf" };
  if (/\b(computer|workstation|livery|paint)\b/.test(t)) return { kind: "panel", panel: "computer" };
  if (/\b(trophy|trophies|awards|silverware)\b/.test(t)) return { kind: "panel", panel: "trophies" };
  if (/\blaunch (practice|control|drill)\b|\bpractice (my |a )?launch/.test(t)) return { kind: "panel", panel: "launch" };

  if (/\b(music|radio|station|song|songs|tunes|synthwave|lofi|lo fi)\b/.test(t))
    return { kind: "music", on: !/\b(off|stop|kill|mute|silence|turn it off)\b/.test(t) };

  const rain = /\b(rain|raining|wet|storm)\b/.test(t)
    ? !/\b(stop|no|off|clear|dry|end)\b/.test(t)
    : /\b(clear skies|dry it|sunny)\b/.test(t)
      ? false
      : null;
  const night = /\b(night|dark|midnight)\b/.test(t)
    ? true
    : /\b(daytime|day time|daylight|morning|sunny)\b/.test(t)
      ? false
      : null;
  if ((rain !== null || night !== null) && !/\b(what|how|why|when|who)\b/.test(t))
    return { kind: "weather", rain, night };

  if (/\b(mute|unmute|sound (on|off)|audio (on|off)|volume)\b/.test(t))
    return { kind: "sound", on: /\b(unmute|on|up)\b/.test(t) };
  if (/\b(replay|intro|entry again)\b/.test(t)) return { kind: "replay" };
  if (/\b(status|systems check|diagnostic|diagnostics|report)\b/.test(t) && words <= 6) return { kind: "status" };
  if (/\b(sit down|take a seat|have a seat|stool)\b/.test(t) || t === "sit") return { kind: "sit" };

  if (/\b(what time|whats the time|time is it|tell me the time)\b/.test(t)) return { kind: "time" };
  if (/\b(what day|whats the date|todays date|what date|the date today)\b/.test(t)) return { kind: "date" };
  if (/\b(what can you do|help me out|commands|what do you do|who are you|what are you|your name)\b/.test(t) || t === "help")
    return { kind: "help" };
  if (
    /^(hi|hello|hey|yo|sup|hiya|howdy|good (morning|afternoon|evening)|how are you|how are you doing|whats up|wassup)\b/.test(t) &&
    words <= 5
  )
    return { kind: "greet" };

  return { kind: "ask", text: raw.trim() };
}

/* -------------------------------------------------------------------------- */
/* Speech plumbing                                                             */
/* -------------------------------------------------------------------------- */

type SpeechAlt = { transcript: string };
type SpeechResult = ArrayLike<SpeechAlt> & { isFinal: boolean };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechCtor = new () => SpeechRec;

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const prefs = [
    /Google UK English Male/i,
    /Microsoft Ryan.*Natural/i,
    /Microsoft (Thomas|George|Ryan)/i,
    /\bDaniel\b/i,
    /Microsoft Guy.*Natural/i,
  ];
  for (const re of prefs) {
    const voice = voices.find((v) => re.test(v.name));
    if (voice) return voice;
  }
  return voices.find((v) => /en[-_]GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

function cleanSpeech(text: string): string {
  return text
    .replace(/^[ \t]*TAKE_CONTROL:[^\n]*$/gim, "")
    .replace(/\n*SOURCES ─[\s\S]*$/, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`~|•·→]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): string[] {
  return norm(text).split(" ").filter((w) => w.length > 2);
}

function to16k(chunks: Float32Array[], rate: number): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  if (rate === 16000) return joined;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += joined[j];
    out[i] = sum / Math.max(1, to - from);
  }
  return out;
}

const PERSONA = `VOICE MODE — you are CYRUS, the voice intelligence that runs this private APEX garage, in the spirit of JARVIS: calm, quick, quietly witty, British-precise.
Your reply is SPOKEN ALOUD. One to three short sentences. No markdown, lists, code blocks, URLs or emoji. Never output a TAKE_CONTROL line in voice mode.
Never say your own name. Do not use honorifics like sir or madam.
The garage: Scotch the white Labrador, Mario the white Persian cat, Mr and Mrs Turtle, a V12 biturbo hypercar on a hydraulic lift, an inline-four hyperbike, a die-cast shelf, a trophy wall, and a floodlit circuit with ramps and boost pads visible through the roller door.`;

const PREF_KEY = "apex.cyrus.v1";
const AWAKE_MS = 7000;
const FOLLOW_UP_MS = 5000;

/* -------------------------------------------------------------------------- */
/* The assistant                                                               */
/* -------------------------------------------------------------------------- */

class Cyrus {
  private snap: CyrusSnapshot = {
    phase: "off",
    ear: null,
    heard: "",
    reply: "",
    status: "SAY “HEY CYRUS”",
    error: null,
    log: [],
  };
  private listeners = new Set<() => void>();
  private handler: CyrusHandler | null = null;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Uint8Array<ArrayBuffer> | null = null;
  private smooth = 0;

  private rec: SpeechRec | null = null;
  private recLive = false;
  private recFails = 0;
  private recStartedAt = 0;

  private processor: ScriptProcessorNode | null = null;
  private processorSink: GainNode | null = null;
  private whisperBusy = false;

  private awakeTimer = 0;
  private gen = 0;
  private pending = 0;
  private streamDone = true;
  private followUp = false;
  private utterances = new Set<SpeechSynthesisUtterance>();
  private spoken = "";
  private speechEndAt = 0;
  private active: AbortController | null = null;
  private history: ChatMessage[] = [];
  private model: { at: number; settings: AiSettings | null } | null = null;

  /* ---- store ---- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): CyrusSnapshot => this.snap;

  private set(patch: Partial<CyrusSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  private pushLog(who: CyrusLine["who"], text: string): void {
    this.set({ log: [...this.snap.log, { who, text }].slice(-8) });
  }

  setHandler(handler: CyrusHandler | null): void {
    this.handler = handler;
  }

  /** The user's standing choice; CYRUS starts itself on garage entry unless switched off. */
  wanted(): boolean {
    try {
      return localStorage.getItem(PREF_KEY) !== "off";
    } catch {
      return true;
    }
  }

  private remember(on: boolean): void {
    try {
      localStorage.setItem(PREF_KEY, on ? "on" : "off");
    } catch {
      // Private contexts drop storage; the live session still works.
    }
  }

  get on(): boolean {
    return this.snap.phase !== "off";
  }

  /** 0..1 loudness for the hologram: the mic while listening, a voice envelope while speaking. */
  level(): number {
    if (this.snap.phase === "speaking") {
      const t = performance.now() / 1000;
      return 0.38 + 0.22 * Math.abs(Math.sin(t * 9.3)) * (0.6 + 0.4 * Math.sin(t * 2.7));
    }
    if (!this.analyser || !this.meterBuf) return 0;
    this.analyser.getByteTimeDomainData(this.meterBuf);
    let sum = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = (this.meterBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.meterBuf.length);
    this.smooth += (Math.min(1, rms * 7) - this.smooth) * 0.35;
    return this.smooth;
  }

  /* ---- lifecycle ---- */

  async enable(): Promise<void> {
    if (this.snap.phase !== "off") return;
    this.set({ phase: "starting", status: "REQUESTING MICROPHONE…", error: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.set({
        phase: "off",
        status: "MIC BLOCKED",
        error: "Microphone access was refused. Allow the mic for this site, then tap the core.",
      });
      return;
    }
    const ctx = this.audio();
    if (ctx && this.stream) {
      const source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.meterBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      source.connect(this.analyser);
    }
    this.remember(true);
    // Voices load lazily in Chrome; asking early means the first reply has one.
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    if (speechCtor()) this.startWebSpeech();
    else void this.startWhisper();
    this.set({ phase: "standby", status: "SAY “HEY CYRUS”" });
    this.chime("online");
  }

  disable(): void {
    this.stopOutput();
    window.clearTimeout(this.awakeTimer);
    this.recLive = false;
    if (this.rec) {
      this.rec.onend = null;
      this.rec.onresult = null;
      this.rec.onerror = null;
      try {
        this.rec.abort();
      } catch {
        // Already stopped.
      }
      this.rec = null;
    }
    this.processor?.disconnect();
    this.processorSink?.disconnect();
    this.processor = null;
    this.processorSink = null;
    this.analyser = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.remember(false);
    this.set({ phase: "off", ear: null, heard: "", status: "MIC OFF" });
  }

  /** Tap-to-talk, like holding the side button: wake without the wake word. */
  async wake(): Promise<void> {
    if (this.snap.phase === "off") {
      await this.enable();
      if (this.snap.phase === "off") return;
    }
    if (this.snap.phase === "speaking" || this.snap.phase === "thinking") this.stopOutput();
    this.goAwake();
  }

  /** Typed commands take the exact same path as spoken ones. */
  submit(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    const { woke, rest } = splitWake(clean);
    if (woke && !rest) {
      void this.wake();
      return;
    }
    this.stopOutput();
    this.command(woke ? rest : clean);
  }

  /* ---- Web Speech ear ---- */

  private startWebSpeech(): void {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = /^en/i.test(navigator.language) ? navigator.language : "en-US";
    rec.onstart = () => {
      this.recStartedAt = performance.now();
    };
    rec.onresult = (event) => {
      this.recFails = 0;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) this.onFinal(text);
        else interim += text;
      }
      if (interim.trim()) this.onInterim(interim.trim());
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed") {
        this.disable();
        this.set({ status: "MIC BLOCKED", error: "Speech recognition was refused microphone access." });
        return;
      }
      // Chromium builds without Google's speech service report "network";
      // the offline ear covers those.
      if (/network|service-not-allowed|language-not-supported|audio-capture/.test(event.error)) {
        this.switchToWhisper();
      }
    };
    rec.onend = () => {
      if (!this.recLive || this.rec !== rec) return;
      // A session that dies instantly over and over is a broken service.
      if (performance.now() - this.recStartedAt < 1200) this.recFails += 1;
      if (this.recFails >= 5) {
        this.switchToWhisper();
        return;
      }
      window.setTimeout(() => {
        if (!this.recLive || this.rec !== rec) return;
        try {
          rec.start();
        } catch {
          // Already restarting.
        }
      }, 220);
    };
    this.rec = rec;
    this.recLive = true;
    this.recFails = 0;
    this.set({ ear: "web-speech" });
    try {
      rec.start();
    } catch {
      this.switchToWhisper();
    }
  }

  private switchToWhisper(): void {
    if (this.snap.ear === "whisper" || this.snap.phase === "off") return;
    this.recLive = false;
    if (this.rec) {
      this.rec.onend = null;
      try {
        this.rec.abort();
      } catch {
        // Already stopped.
      }
      this.rec = null;
    }
    void this.startWhisper();
  }

  /* ---- Offline Whisper ear with voice-activity detection ---- */

  private async startWhisper(): Promise<void> {
    const ctx = this.audio();
    if (!ctx || !this.stream) return;
    this.set({ ear: "whisper", status: "LOADING OFFLINE EAR…" });
    let asr: { transcribe(pcm: Float32Array): Promise<string> };
    try {
      const { loadAsr } = await import("../components/mesh/embed");
      asr = await loadAsr((event) => {
        if (event.status !== "ready") this.set({ status: `LOADING OFFLINE EAR ${Math.round(event.pct)}%` });
      });
    } catch {
      this.set({ status: "EAR OFFLINE", error: "The offline speech model failed to load. Type to CYRUS instead." });
      return;
    }
    if (this.snap.phase === "off" || !this.stream) return;
    this.set({ status: "SAY “HEY CYRUS”" });

    const source = ctx.createMediaStreamSource(this.stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
    this.processor = processor;
    this.processorSink = sink;

    const rate = ctx.sampleRate;
    const frameMs = (4096 / rate) * 1000;
    const preroll: Float32Array[] = [];
    let chunks: Float32Array[] = [];
    let talking = false;
    let quietMs = 0;
    let talkMs = 0;
    let floor = 0.006;

    const finish = (): void => {
      const pcm = to16k(chunks, rate);
      chunks = [];
      talking = false;
      if (talkMs < 380 || this.whisperBusy) return;
      this.whisperBusy = true;
      void asr
        .transcribe(pcm)
        .then((text) => {
          const clean = text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
          if (clean.length > 1 && !/^(you|thank you\.?|\.+)$/i.test(clean)) this.onFinal(clean);
        })
        .catch(() => undefined)
        .finally(() => {
          this.whisperBusy = false;
        });
    };

    processor.onaudioprocess = (event) => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const threshold = Math.max(0.014, floor * 3.2);
      // CYRUS never transcribes its own voice coming back through the speakers.
      const deaf = this.snap.phase === "speaking" || this.snap.phase === "thinking";
      if (!talking) {
        floor = Math.max(0.003, floor * 0.995 + rms * 0.005);
        preroll.push(data);
        if (preroll.length > 4) preroll.shift();
        if (rms > threshold && !deaf) {
          talking = true;
          quietMs = 0;
          talkMs = 0;
          chunks = [...preroll];
        }
        return;
      }
      chunks.push(data);
      talkMs += frameMs;
      quietMs = rms > threshold * 0.7 ? 0 : quietMs + frameMs;
      if (quietMs > 750 || talkMs > 9000) finish();
    };
  }

  /* ---- Turn handling ---- */

  private onInterim(text: string): void {
    const phase = this.snap.phase;
    const { woke, rest } = splitWake(text);
    if (phase === "standby") {
      if (woke) {
        this.goAwake();
        this.set({ heard: rest });
      }
      return;
    }
    if (phase === "speaking" || phase === "thinking") {
      if (woke) {
        this.stopOutput();
        this.goAwake();
        this.set({ heard: rest });
      }
      return;
    }
    if (phase === "awake") {
      this.set({ heard: woke ? rest : text });
      this.armAwake(AWAKE_MS);
    }
  }

  private onFinal(raw: string): void {
    const text = raw.trim();
    if (!text) return;
    const phase = this.snap.phase;
    const { woke, rest } = splitWake(text);

    if (phase === "speaking" || phase === "thinking") {
      if (woke) {
        this.stopOutput();
        if (rest) this.command(rest);
        else this.goAwake();
      } else if (/^(stop|cancel|quiet|shut up|enough)\b/i.test(text) && text.split(/\s+/).length <= 3) {
        this.stopOutput();
        this.toStandby(false);
      }
      return;
    }
    if (phase === "standby") {
      if (!woke) return;
      if (rest) this.command(rest);
      else this.goAwake();
      return;
    }
    if (phase === "awake") {
      const said = woke ? rest : text;
      if (!said) return;
      if (!woke && this.isEcho(said)) return;
      this.command(said);
    }
  }

  // Speakers leak into the mic; a transcript that mostly repeats what CYRUS
  // just said, right after it said it, is an echo rather than a request.
  private isEcho(text: string): boolean {
    if (performance.now() - this.speechEndAt > 4000) return false;
    const said = new Set(wordSet(this.spoken));
    const heard = wordSet(text);
    if (!said.size || heard.length < 2) return false;
    const overlap = heard.filter((w) => said.has(w)).length / heard.length;
    return overlap > 0.6;
  }

  private goAwake(): void {
    if (this.snap.phase !== "awake") this.chime("wake");
    this.followUp = false;
    this.set({ phase: "awake", heard: "", status: "LISTENING" });
    this.armAwake(AWAKE_MS);
  }

  private armAwake(ms: number): void {
    window.clearTimeout(this.awakeTimer);
    this.awakeTimer = window.setTimeout(() => {
      if (this.snap.phase === "awake") this.toStandby(!this.followUp);
    }, ms);
  }

  private toStandby(withChime: boolean): void {
    window.clearTimeout(this.awakeTimer);
    if (withChime && this.snap.phase === "awake") this.chime("sleep");
    this.set({ phase: this.on ? "standby" : "off", heard: "", status: "SAY “HEY CYRUS”" });
  }

  private command(text: string): void {
    window.clearTimeout(this.awakeTimer);
    this.set({ heard: text });
    this.pushLog("you", text);
    const intent = parseIntent(text);
    switch (intent.kind) {
      case "stop":
        this.stopOutput();
        this.toStandby(false);
        return;
      case "off":
        this.say("Going quiet. Tap the core when you need me.", false);
        window.setTimeout(() => this.disable(), 2200);
        return;
      case "sleep":
        this.say(pick(["Standing by.", "I'll be here.", "Standing by. The bay is yours."]), false);
        return;
      case "thanks":
        this.say(pick(["Anytime.", "Always.", "Of course.", "That's what I'm here for."]));
        return;
      case "greet":
        this.say(greeting());
        return;
      case "help":
        this.say(
          "I run the bay. Call Scotch or Mario, open the door, raise the lift, rev the V12, play music, make it rain, take the car or the bike to the circuit, or ask me anything at all.",
        );
        return;
      case "time":
        this.say(`It's ${new Date().toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })}.`);
        return;
      case "date":
        this.say(`Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);
        return;
      case "ask":
        void this.ask(intent.text);
        return;
      default: {
        const line = this.handler?.(intent);
        if (line === undefined) {
          this.say("The bay systems aren't connected yet.");
          return;
        }
        this.say(line ?? "That isn't available from here.");
      }
    }
  }

  /* ---- Speaking ---- */

  private stopOutput(): void {
    this.gen += 1;
    this.active?.abort();
    this.active = null;
    this.pending = 0;
    this.streamDone = true;
    this.utterances.clear();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  private say(text: string, followUp = true): void {
    this.stopOutput();
    this.spoken = "";
    this.followUp = followUp;
    this.streamDone = false;
    this.set({ reply: text, phase: "speaking", status: "SPEAKING" });
    this.pushLog("cyrus", text);
    const gen = this.gen;
    for (const sentence of splitSentences(text)) this.queue(sentence, gen);
    this.streamDone = true;
    this.maybeFinished(gen);
  }

  private queue(text: string, gen: number): void {
    const clean = cleanSpeech(text);
    if (!clean || gen !== this.gen) return;
    this.spoken += ` ${clean}`;
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = 1.04;
    utterance.pitch = 0.9;
    utterance.volume = 1;
    this.pending += 1;
    this.utterances.add(utterance);
    let done = false;
    let watch = window.setTimeout(() => finish(), 30000);
    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(watch);
      this.utterances.delete(utterance);
      if (gen !== this.gen) return;
      this.pending = Math.max(0, this.pending - 1);
      this.maybeFinished(gen);
    };
    // Chrome occasionally drops onend; a length-based watchdog keeps the turn moving.
    utterance.onstart = () => {
      window.clearTimeout(watch);
      watch = window.setTimeout(finish, 2500 + clean.split(/\s+/).length * 520);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    if (this.snap.phase !== "speaking") this.set({ phase: "speaking", status: "SPEAKING" });
    window.speechSynthesis.speak(utterance);
  }

  private maybeFinished(gen: number): void {
    if (gen !== this.gen || this.pending > 0 || !this.streamDone) return;
    this.speechEndAt = performance.now();
    if (this.snap.phase === "off") return;
    this.chime("done");
    if (this.followUp) {
      // Continued conversation: a short window to follow up without the wake word.
      this.set({ phase: "awake", heard: "", status: "FOLLOW UP…" });
      this.armAwake(FOLLOW_UP_MS);
    } else {
      this.toStandby(false);
    }
  }

  /* ---- Answers ---- */

  private async resolveModel(): Promise<AiSettings | null> {
    const base = loadSettings();
    if (base.provider === "openai" && base.endpoint && base.model) return base;
    if (base.provider === "ollama" && base.model) return base;
    if (this.model && Date.now() - this.model.at < 60000) return this.model.settings;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    let settings: AiSettings | null = null;
    try {
      const models = await listOllamaModels(base.endpoint || "http://127.0.0.1:11434", controller.signal);
      const best = pickBestModel(models);
      if (best) settings = { ...base, provider: "ollama", model: best };
    } catch {
      settings = null;
    } finally {
      window.clearTimeout(timer);
    }
    this.model = { at: Date.now(), settings };
    return settings;
  }

  private async ask(question: string): Promise<void> {
    this.stopOutput();
    const gen = this.gen;
    const controller = new AbortController();
    this.active = controller;
    this.spoken = "";
    this.followUp = true;
    this.streamDone = false;
    this.set({ phase: "thinking", status: "THINKING", reply: "" });

    const settings = await this.resolveModel();
    if (gen !== this.gen) return;

    let grounding: Grounding | null = null;
    if (needsGrounding(question) || !settings) {
      const cap = new AbortController();
      const forward = () => cap.abort();
      controller.signal.addEventListener("abort", forward, { once: true });
      const timer = window.setTimeout(() => cap.abort(), 3200);
      try {
        grounding = await retrieveGrounding(question, cap.signal, 2600);
      } catch {
        grounding = null;
      } finally {
        window.clearTimeout(timer);
        controller.signal.removeEventListener("abort", forward);
      }
      if (gen !== this.gen) return;
    }

    if (grounding?.quick) {
      this.say(cleanSpeech(grounding.quick));
      return;
    }
    if (!settings) {
      const summary = grounding ? splitSentences(cleanSpeech(grounding.summary)).slice(0, 2).join(" ") : "";
      this.say(
        summary ||
          "My local model is offline, so I can only run the bay right now. Start Ollama and I'll answer anything.",
      );
      return;
    }

    let full = "";
    let buffer = "";
    const flush = (final: boolean): void => {
      while (true) {
        const match = /^([\s\S]*?[.!?…])(\s+)/.exec(buffer);
        if (!match) break;
        this.queue(match[1], gen);
        buffer = buffer.slice(match[0].length);
      }
      if (final && buffer.trim()) {
        this.queue(buffer, gen);
        buffer = "";
      }
    };
    try {
      await streamChat({
        settings,
        messages: [...this.history, { role: "user", content: question }],
        signal: controller.signal,
        grounding,
        knowledge: knowledgeContext(question, 4) || undefined,
        extraSystem: PERSONA,
        temperature: 0.5,
        numPredict: 170,
        onToken: (token) => {
          if (gen !== this.gen) return;
          full += token;
          buffer += token;
          this.set({ reply: cleanSpeech(full) });
          flush(false);
        },
      });
    } catch {
      if (gen !== this.gen) return;
      if (!full) {
        this.say("I couldn't reach the local model. Check that Ollama is running.");
        return;
      }
    }
    if (gen !== this.gen) return;
    flush(true);
    const answer = cleanSpeech(full);
    if (!answer) {
      this.say("I drew a blank on that one. Try asking another way.");
      return;
    }
    this.history = [
      ...this.history,
      { role: "user" as const, content: question },
      { role: "assistant" as const, content: answer },
    ].slice(-8);
    this.pushLog("cyrus", answer);
    this.streamDone = true;
    this.maybeFinished(gen);
  }

  /* ---- Earcons ---- */

  private audio(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private chime(kind: "wake" | "sleep" | "done" | "online"): void {
    const ctx = this.audio();
    if (!ctx) return;
    const notes = { wake: [660, 990], sleep: [880, 520], done: [1320], online: [520, 780, 1040] }[kind];
    const peak = kind === "done" ? 0.035 : 0.075;
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  }
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function greeting(): string {
  const hour = new Date().getHours();
  const part = hour < 5 ? "You're up late." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  return `${part} ${pick([
    "All systems are live. The bay is yours.",
    "Everything's warm and the circuit is lit.",
    "What are we doing today?",
    "Scotch has been waiting for you.",
  ])}`;
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+(?=\s|$)|[^.!?…]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

export const cyrus = new Cyrus();

export function useCyrus(): CyrusSnapshot {
  return useSyncExternalStore(cyrus.subscribe, cyrus.snapshot, cyrus.snapshot);
}

if (import.meta.env.DEV) {
  (window as unknown as { __cyrus?: Cyrus }).__cyrus = cyrus;
}
