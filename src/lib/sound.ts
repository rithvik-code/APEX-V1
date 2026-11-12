// Gear-change timetable in seconds from ignition. Engine.ts reads the same
// table so the flame/glow pops land on the audible shift cracks.
export const REV_SHIFTS: Record<"car" | "bike", number[]> = {
  car: [0.46, 1.0, 1.56, 2.16, 2.8, 3.5, 4.24],
  bike: [0.38, 0.88, 1.4, 1.96, 2.56, 3.2],
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private crackleBuffer: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rev: {
    kind: "car" | "bike";
    bus: GainNode;
    oscs: OscillatorNode[];
    pops: AudioScheduledSourceNode[];
  } | null = null;
  private idle: {
    gain: GainNode;
    oscs: OscillatorNode[];
    timer: number;
  } | null = null;
  private station: {
    gain: GainNode;
    sources: AudioScheduledSourceNode[];
    tone: BiquadFilterNode;
    noise: GainNode;
  } | null = null;
  private stationIndex = 0;
  private stationDial = 0.6;

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

    // Sparse pops for the lo-fi deck: short decaying clicks over silence.
    const crackleBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const crackleData = crackleBuffer.getChannelData(0);
    for (let i = 0; i < crackleData.length; i++) crackleData[i] = 0;
    for (let pop = 0; pop < 260; pop++) {
      const start = Math.floor(Math.random() * (crackleData.length - 400));
      const strength = 0.25 + Math.random() * 0.75;
      const length = 20 + Math.floor(Math.random() * 120);
      for (let i = 0; i < length; i++) {
        crackleData[start + i] +=
          (Math.random() * 2 - 1) * strength * Math.pow(1 - i / length, 3);
      }
    }
    this.crackleBuffer = crackleBuffer;
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
    if (!this.enabled) {
      this.releaseRev(0.1);
      this.stopIdle();
      this.silenceStation();
    }
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

  // Crossing the tunnel ring: a long rising rush that bottoms out into a sub
  // thump as the flash takes the screen.
  warp(): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(5200, now + 1.15);
    filter.frequency.exponentialRampToValueAtTime(220, now + 1.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.55);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 1.6);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now + 1.06);
    thump.frequency.exponentialRampToValueAtTime(34, now + 1.42);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now + 1.06);
    thumpGain.gain.exponentialRampToValueAtTime(0.34, now + 1.1);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    thump.connect(thumpGain);
    thumpGain.connect(this.master);
    thump.start(now + 1.06);
    thump.stop(now + 1.52);
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

  // Hold-to-rev: a continuous engine note that climbs a gearbox instead of a
  // one-shot blip. Each shift cuts ignition for ~10 ms, cracks the exhaust and
  // snaps the pitch back down. Hold past the top gear and it bounces off the
  // limiter; release and the overrun burbles out. The V12 is low, wide and
  // harmonic; the inline-four is tighter, brighter and more metallic.
  startRev(kind: "car" | "bike"): void {
    if (!this.enabled) return;
    const ctx = this.init();
    if (ctx.state === "suspended") void ctx.resume();
    if (!this.master || !this.noiseBuffer) return;
    this.releaseRev(0.03);

    const now = ctx.currentTime + 0.01;
    const car = kind === "car";
    const base = car ? 42 : 66;
    const peak = car ? 5.4 : 6.1;
    const idle = 0.52;
    const shifts = REV_SHIFTS[kind];

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(car ? 0.32 : 0.23, now + 0.06);
    bus.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = car ? 6.5 : 3.6;
    filter.frequency.setValueAtTime(car ? 300 : 420, now);
    filter.frequency.exponentialRampToValueAtTime(
      car ? 2300 : 3300,
      now + shifts[Math.min(2, shifts.length - 1)],
    );

    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (car ? 2.6 : 3.4));
    }
    drive.curve = curve;
    filter.connect(drive);
    drive.connect(bus);

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

    const oscs: OscillatorNode[] = [];
    const pops: AudioScheduledSourceNode[] = [];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.detune.value = voice.detune;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = voice.gain;
      const ratio = base * voice.ratio;
      let segStart = now;
      osc.frequency.setValueAtTime(ratio * idle, segStart);
      for (let gear = 0; gear < shifts.length; gear++) {
        const segEnd = now + shifts[gear];
        // The drop to a lower ratio at each boundary is the gear change.
        if (gear > 0) osc.frequency.setValueAtTime(ratio * 0.42, segStart);
        osc.frequency.exponentialRampToValueAtTime(ratio * peak, segEnd - 0.012);
        segStart = segEnd;
      }
      // Limiter: chop the last 6% of the redline every few tenths.
      const limiterAt = now + shifts[shifts.length - 1];
      for (let i = 0; i < 20; i++) {
        const at = limiterAt + i * 0.34;
        osc.frequency.setValueAtTime(ratio * peak, at);
        osc.frequency.setValueAtTime(ratio * peak * 0.93, at + 0.05);
        osc.frequency.setValueAtTime(ratio * peak, at + 0.12);
      }
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start(now);
      oscs.push(osc);
    }

    // Mechanical shift: noise crack + selector clack + ignition-cut duck.
    const shiftCrack = (at: number, loudness: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer!;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = car ? 860 : 1500;
      band.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(loudness, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
      src.connect(band);
      band.connect(gain);
      gain.connect(this.master!);
      src.start(at);
      src.stop(at + 0.07);
      pops.push(src);

      const clack = ctx.createOscillator();
      clack.type = "square";
      clack.frequency.setValueAtTime(car ? 118 : 158, at);
      const clackGain = ctx.createGain();
      clackGain.gain.setValueAtTime(loudness * 0.55, at);
      clackGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
      clack.connect(clackGain);
      clackGain.connect(this.master!);
      clack.start(at);
      clack.stop(at + 0.06);
      pops.push(clack);

      const level = car ? 0.32 : 0.23;
      bus.gain.setValueAtTime(level, at - 0.012);
      bus.gain.linearRampToValueAtTime(level * 0.42, at + 0.012);
      bus.gain.linearRampToValueAtTime(level * 0.94, at + 0.13);
    };

    for (let i = 0; i < shifts.length; i++) {
      shiftCrack(now + shifts[i] - 0.015, (car ? 0.26 : 0.2) * (1 - i * 0.05));
    }
    // Limiter crackle keeps the held rev alive once the gearbox runs out.
    const limiterAt = shifts[shifts.length - 1];
    for (let i = 0; i < 24; i++) {
      shiftCrack(now + limiterAt + 0.12 + i * 0.34, i % 2 === 0 ? 0.14 : 0.08);
    }

    this.rev = { kind, bus, oscs, pops };
  }

  endRev(): void {
    const rev = this.rev;
    if (!rev || !this.ctx || !this.master || !this.noiseBuffer) {
      this.rev = null;
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const car = rev.kind === "car";
    // Overrun burble as the throttle snaps shut.
    for (let i = 0; i < 5; i++) {
      const at = now + 0.03 + i * 0.075 + Math.random() * 0.02;
      this.revPop(car, at, (car ? 0.15 : 0.1) * (1 - i * 0.16));
    }
    this.releaseRev(0.16);
  }

  private revPop(car: boolean, at: number, loudness: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
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
    gain.connect(this.master);
    src.start(at);
    src.stop(at + 0.09);
  }

  private releaseRev(fade: number): void {
    const rev = this.rev;
    if (!rev || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.rev = null;
    rev.bus.gain.cancelScheduledValues(now);
    rev.bus.gain.setValueAtTime(Math.max(0.0001, rev.bus.gain.value), now);
    rev.bus.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fade));
    for (const osc of rev.oscs) {
      try {
        osc.stop(now + fade + 0.03);
      } catch {
        // Already stopped.
      }
    }
    for (const pop of rev.pops) {
      try {
        pop.stop(now + 0.02);
      } catch {
        // Already stopped.
      }
    }
  }

  private noiseBurst(
    frequency: number,
    q: number,
    peak: number,
    duration: number,
    type: BiquadFilterType = "bandpass",
    rate = 1,
  ): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.03);
  }

  // Bay idle: a low, warm engine bed with the occasional exhaust tick.
  startIdle(kind: "car" | "bike"): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    if (this.idle) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "car" ? 320 : 540;
    filter.Q.value = 2;
    const a = ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = kind === "car" ? 36 : 52;
    const b = ctx.createOscillator();
    b.type = "triangle";
    b.frequency.value = kind === "car" ? 72 : 104;
    b.detune.value = 7;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    gain.gain.setTargetAtTime(kind === "car" ? 0.032 : 0.026, ctx.currentTime, 0.7);
    a.start();
    b.start();
    const timer = window.setInterval(() => {
      if (!this.enabled) return;
      this.noiseBurst(140 + Math.random() * 130, 0.9, 0.05, 0.16, "lowpass");
    }, 2200 + Math.random() * 2400);
    this.idle = { gain, oscs: [a, b], timer };
  }

  stopIdle(): void {
    const idle = this.idle;
    if (!idle || !this.ctx) return;
    this.idle = null;
    window.clearInterval(idle.timer);
    const now = this.ctx.currentTime;
    idle.gain.gain.cancelScheduledValues(now);
    idle.gain.gain.setValueAtTime(Math.max(0.0001, idle.gain.gain.value), now);
    idle.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    for (const osc of idle.oscs) {
      try {
        osc.stop(now + 0.45);
      } catch {
        // Already stopped.
      }
    }
  }

  footstep(sprint = false): void {
    this.noiseBurst(sprint ? 320 : 210, 1.1, sprint ? 0.1 : 0.062, 0.12, "lowpass");
  }

  meow(): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(560, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(470, now + 0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 2.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  hydraulic(): void {
    this.noiseBurst(820, 0.8, 0.13, 0.85, "bandpass", 1.1);
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.85;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(90, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  garageDoor(open: boolean): void {
    this.noiseBurst(open ? 120 : 90, 0.7, 0.15, 1.25, "lowpass", 1.5);
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 1.18;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  launchBeep(go = false): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = go ? 880 : 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (go ? 0.34 : 0.1));
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + (go ? 0.36 : 0.12));
  }

  private silenceStation(): void {
    const station = this.station;
    if (!station || !this.ctx) return;
    this.station = null;
    const now = this.ctx.currentTime;
    station.gain.gain.cancelScheduledValues(now);
    station.gain.gain.setValueAtTime(Math.max(0.0001, station.gain.gain.value), now);
    station.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    for (const src of station.sources) {
      try {
        src.stop(now + 0.16);
      } catch {
        // Already stopped.
      }
    }
  }

  // 0 off · 1 pit wall · 2 synth wave · 3 engine radio · 4 lo-fi deck.
  setStation(index: number): void {
    this.silenceStation();
    this.stationIndex = index;
    if (index <= 0 || !this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);
    // The dial trims the top end of the whole station and opens up the noise
    // floor, so one knob walks from muffled tape to open broadcast.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 420 + this.stationDial * 8600;
    tone.Q.value = 0.7;
    tone.connect(gain);
    const noise = ctx.createGain();
    noise.gain.value = 0.35 + (1 - this.stationDial) * 0.55;
    noise.connect(tone);
    const sources: AudioScheduledSourceNode[] = [];
    const tone2 = (freq: number, type: OscillatorType, level: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(tone);
      osc.start();
      sources.push(osc);
    };
    if (index === 1) {
      tone2(392, "sine", 0.5);
      tone2(523, "sine", 0.3);
      const src = ctx.createBufferSource();
      if (this.noiseBuffer) {
        src.buffer = this.noiseBuffer;
        src.loop = true;
        src.playbackRate.value = 0.5;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1400;
        filter.Q.value = 1.6;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.05;
        src.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(noise);
        src.start();
        sources.push(src);
      }
    } else if (index === 2) {
      tone2(110, "sawtooth", 0.35);
      tone2(164.8, "sawtooth", 0.28);
      tone2(220, "triangle", 0.22);
    } else if (index === 3) {
      tone2(55, "sawtooth", 0.5);
      tone2(82.5, "sawtooth", 0.3);
    } else {
      // Lo-fi: a warm chord that drifts under tape hiss and vinyl crackle.
      const chord = [174.61, 220, 261.63, 329.63];
      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = i % 2 ? "triangle" : "sine";
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = 0.13;
        osc.connect(g);
        g.connect(tone);
        osc.start();
        sources.push(osc);
        // Wow and flutter: a slow detune wobble, faster on the top strings.
        const wow = ctx.createOscillator();
        wow.frequency.value = 0.21 + i * 0.07;
        const wowGain = ctx.createGain();
        wowGain.gain.value = freq * 0.009;
        wow.connect(wowGain);
        wowGain.connect(osc.frequency);
        wow.start();
        sources.push(wow);
      });
      if (this.noiseBuffer) {
        const hiss = ctx.createBufferSource();
        hiss.buffer = this.noiseBuffer;
        hiss.loop = true;
        hiss.playbackRate.value = 0.85;
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = "highpass";
        hissFilter.frequency.value = 2200;
        const hissGain = ctx.createGain();
        hissGain.gain.value = 0.05;
        hiss.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(noise);
        hiss.start();
        sources.push(hiss);
      }
      if (this.crackleBuffer) {
        const crackle = ctx.createBufferSource();
        crackle.buffer = this.crackleBuffer;
        crackle.loop = true;
        const crackleGain = ctx.createGain();
        crackleGain.gain.value = 0.5;
        crackle.connect(crackleGain);
        crackleGain.connect(noise);
        crackle.start();
        sources.push(crackle);
      }
    }
    gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.3);
    this.station = { gain, sources, tone, noise };
  }

  // 0 muffled tape · 1 open broadcast.
  setStationMix(dial: number): void {
    const value = Math.max(0, Math.min(1, dial));
    this.stationDial = value;
    const station = this.station;
    if (!station || !this.ctx) return;
    const now = this.ctx.currentTime;
    station.tone.frequency.setTargetAtTime(420 + value * 8600, now, 0.06);
    station.noise.gain.setTargetAtTime(0.35 + (1 - value) * 0.55, now, 0.06);
  }

  get stationTone(): number {
    return this.stationDial;
  }

  get currentStation(): number {
    return this.stationIndex;
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
