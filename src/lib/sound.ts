class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;

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

    low.start();
    high.start();
    noise.start();

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
