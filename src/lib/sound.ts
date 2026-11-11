class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

  private init(): AudioContext {
    if (this.ctx) return this.ctx;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtor();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.055;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 190;
    filter.Q.value = 2.4;

    const low = ctx.createOscillator();
    low.type = "sawtooth";
    low.frequency.value = 42.5;
    const high = ctx.createOscillator();
    high.type = "sawtooth";
    high.frequency.value = 57.2;
    high.detune.value = 6;

    low.connect(filter);
    high.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(master);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = noiseBuffer;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 780;
    noiseFilter.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.035;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);

    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    wind.playbackRate.value = 0.82;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.9;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    this.windFilter = windFilter;
    this.windGain = windGain;

    // Dyno engine note — two detuned oscillators whose pitch tracks RPM.
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 700;
    engineFilter.Q.value = 3;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineA = ctx.createOscillator();
    engineA.type = "sawtooth";
    engineA.frequency.value = 40;
    const engineB = ctx.createOscillator();
    engineB.type = "square";
    engineB.frequency.value = 81;
    engineB.detune.value = 9;
    engineA.connect(engineFilter);
    engineB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;
    this.engineOscA = engineA;
    this.engineOscB = engineB;

    // Rain bed — bright filtered noise, level tracks the weather slider.
    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuffer;
    rain.loop = true;
    rain.playbackRate.value = 1.5;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = "bandpass";
    rainFilter.frequency.value = 1800;
    rainFilter.Q.value = 0.5;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rain.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    low.start();
    high.start();
    noise.start();
    wind.start();
    engineA.start();
    engineB.start();
    rain.start();

    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  toggle(): boolean {
    const ctx = this.init();
    if (ctx.state === "suspended") void ctx.resume();
    this.enabled = !this.enabled;
    this.master?.gain.setTargetAtTime(
      this.enabled ? 0.5 : 0,
      ctx.currentTime,
      0.35,
    );
    if (this.enabled) this.tick("start");
    return this.enabled;
  }

  get isOn(): boolean {
    return this.enabled;
  }

  setWind(level: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level * 0.3, now, 0.25);
    this.windFilter.frequency.setTargetAtTime(300 + level * 1050, now, 0.25);
  }

  setEngine(norm: number): void {
    if (!this.ctx || !this.engineGain || !this.engineOscA || !this.engineOscB || !this.engineFilter) return;
    const now = this.ctx.currentTime;
    const n = Math.min(1, Math.max(0, norm));
    const freq = 34 + n * 214;
    this.engineOscA.frequency.setTargetAtTime(freq, now, 0.07);
    this.engineOscB.frequency.setTargetAtTime(freq * 2.02, now, 0.07);
    this.engineFilter.frequency.setTargetAtTime(480 + n * 2800, now, 0.09);
    this.engineGain.gain.setTargetAtTime(n > 0.001 ? 0.05 + n * 0.17 : 0, now, 0.12);
  }

  setRain(level: number): void {
    if (!this.ctx || !this.rainGain || !this.rainFilter) return;
    const now = this.ctx.currentTime;
    const n = Math.min(1, Math.max(0, level));
    this.rainGain.gain.setTargetAtTime(n * 0.13, now, 0.3);
    this.rainFilter.frequency.setTargetAtTime(1200 + n * 2400, now, 0.3);
  }

  // A short radio squelch burst, played around pit-wall voice replies.
  radio(): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1700;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.22);
  }

  whoosh(): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.6);
  }

  // A full throttle blip: layered oscillators swept from idle to redline and
  // back, with exhaust overrun crackle on the way down. The V12 is low, wide
  // and harmonic; the inline-four is tighter, brighter and more metallic.
  revEngine(kind: "car" | "bike"): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const car = kind === "car";
    const duration = car ? 2.25 : 1.7;
    const base = car ? 42 : 66;
    const peak = car ? 5.4 : 6.1;
    const idle = 0.52;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(car ? 0.34 : 0.24, now + 0.07);
    bus.gain.setValueAtTime(car ? 0.3 : 0.21, now + duration * 0.52);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    bus.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = car ? 6.5 : 3.6;
    filter.frequency.setValueAtTime(car ? 300 : 420, now);
    filter.frequency.exponentialRampToValueAtTime(car ? 2600 : 3400, now + duration * 0.36);
    filter.frequency.exponentialRampToValueAtTime(car ? 520 : 760, now + duration * 0.96);

    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (car ? 2.6 : 3.4));
    }
    drive.curve = curve;
    drive.connect(bus);
    filter.connect(drive);

    const voices = car
      ? [
          { ratio: 0.5, type: "sine" as OscillatorType, detune: 0, gain: 0.9 },
          { ratio: 0.5, type: "sawtooth" as OscillatorType, detune: -4, gain: 0.55 },
          { ratio: 1, type: "sawtooth" as OscillatorType, detune: 5, gain: 0.5 },
          { ratio: 1.5, type: "sawtooth" as OscillatorType, detune: -6, gain: 0.34 },
          { ratio: 2, type: "sawtooth" as OscillatorType, detune: 3, gain: 0.3 },
          { ratio: 3, type: "square" as OscillatorType, detune: -3, gain: 0.16 },
          { ratio: 4.5, type: "sawtooth" as OscillatorType, detune: 7, gain: 0.11 },
        ]
      : [
          { ratio: 1, type: "sawtooth" as OscillatorType, detune: 0, gain: 0.6 },
          { ratio: 1.01, type: "square" as OscillatorType, detune: 6, gain: 0.36 },
          { ratio: 2, type: "sawtooth" as OscillatorType, detune: -5, gain: 0.4 },
          { ratio: 3.02, type: "square" as OscillatorType, detune: 4, gain: 0.22 },
          { ratio: 4.04, type: "sawtooth" as OscillatorType, detune: -7, gain: 0.14 },
        ];

    const upAt = now + duration * 0.34;
    const holdAt = now + duration * 0.48;
    const downAt = now + duration * 0.92;

    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.detune.value = voice.detune;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = voice.gain;
      const fIdle = base * voice.ratio * idle;
      const fPeak = base * voice.ratio * peak;
      osc.frequency.setValueAtTime(fIdle, now);
      osc.frequency.exponentialRampToValueAtTime(fPeak, upAt);
      osc.frequency.setValueAtTime(fPeak, holdAt);
      osc.frequency.exponentialRampToValueAtTime(fIdle * 0.88, downAt);
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    }

    // Ignition thump plus exhaust pops on the overrun.
    const pop = (at: number, loudness: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = car ? 900 : 1400;
      band.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(loudness, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
      src.connect(band);
      band.connect(gain);
      gain.connect(this.master!);
      src.start(at);
      src.stop(at + 0.09);
    };
    pop(now + 0.01, car ? 0.22 : 0.14);
    for (let i = 0; i < 5; i++) {
      pop(now + duration * (0.52 + i * 0.075), (car ? 0.16 : 0.11) * (1 - i * 0.12));
    }
  }

  tick(kind: "start" | "click" | "hover" | "key" = "click"): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const freq =
      kind === "start" ? 220 : kind === "hover" ? 980 : kind === "key" ? 1500 : 1250;
    osc.type = kind === "start" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + 0.07);
    gain.gain.setValueAtTime(kind === "hover" ? 0.018 : 0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.1);
  }
}

export const sound = new SoundEngine();
