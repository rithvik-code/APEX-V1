import { sound } from "./sound";

type RecognitionResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function pttSupported(): boolean {
  return recognitionCtor() !== null;
}

export function voxSupported(): boolean {
  return "speechSynthesis" in window;
}

export type Recognizer = {
  start(): void;
  stop(): void;
};

export function createRecognizer(
  onResult: (text: string) => void,
  onEnd: () => void,
): Recognizer | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const transcript = last?.[0]?.transcript?.trim();
    if (transcript) onResult(transcript);
  };
  recognition.onend = onEnd;
  recognition.onerror = onEnd;
  return {
    start: () => {
      try {
        recognition.start();
      } catch {
        onEnd();
      }
    },
    stop: () => recognition.stop(),
  };
}

export function speakRadio(text: string): void {
  if (!voxSupported()) return;
  const clean = text
    .replace(/^[ \t]*TAKE_CONTROL:[^\n]*$/gim, "")
    .replace(/\n*SOURCES ─[\s\S]*$/, "")
    .replace(/\s+/g, " ")
    .replace(/[→·|]/g, ",")
    .trim()
    .slice(0, 480);
  if (!clean) return;
  window.speechSynthesis.cancel();
  sound.radio();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 0.92;
  utterance.volume = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((voice) => /en[-_]GB/i.test(voice.lang)) ??
    voices.find((voice) => /^en/i.test(voice.lang));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

export function stopRadio(): void {
  if (voxSupported()) window.speechSynthesis.cancel();
}