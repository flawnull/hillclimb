/**
 * VAL BORBERA HILLCLIMB — Procedural WebAudio Sound Engine
 * 
 * 0 KB asset cost, dynamic procedural engine synthesis (§11):
 * - Two detuned sawtooth oscillators + 1 square sub-oscillator
 * - Filter cutoff mapping to throttle and RPM
 * - Synthesized tire squeal noise on drift
 * - Procedural wall scrape crash sound
 * - Checkpoint chimes and countdown beeps
 */

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterGain: GainNode | null = null;

  // Engine synthesis nodes
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Tire squeal synthesis
  private squealOsc: OscillatorNode | null = null;
  private squealGain: GainNode | null = null;

  // Wind rush noise synthesis
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private isStarted: boolean = false;

  constructor() {
    // AudioContext created lazily on user gesture
  }

  public init(): void {
    if (this.isStarted || typeof window === "undefined") return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.75;
      this.masterGain.connect(this.ctx.destination);

      // 1. Engine Synthesis: Harmonic Oscillator Bank
      // Fundamental (Triangle), Sub-rumble (Sine), Mechanical growl (Warm Sawtooth with dedicated filter)
      this.osc1 = this.ctx.createOscillator();
      this.osc2 = this.ctx.createOscillator();
      this.subOsc = this.ctx.createOscillator();

      this.osc1.type = "triangle"; // Smooth fundamental body
      this.osc2.type = "sawtooth"; // Mechanical growl
      this.subOsc.type = "sine";   // Sub-bass exhaust rumble

      this.osc1.detune.value = 0;
      this.osc2.detune.value = 7;
      this.subOsc.detune.value = -1200; // 1 octave lower

      // Main Throaty Exhaust Filter
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 320;
      this.filter.Q.value = 2.2;

      // Secondary shaping filter for osc2 to remove harsh buzzing
      const osc2PreFilter = this.ctx.createBiquadFilter();
      osc2PreFilter.type = "lowpass";
      osc2PreFilter.frequency.value = 900;
      osc2PreFilter.Q.value = 1.0;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.28;

      this.osc1.connect(this.filter);
      this.subOsc.connect(this.filter);
      this.osc2.connect(osc2PreFilter);
      osc2PreFilter.connect(this.filter);

      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.osc1.start();
      this.osc2.start();
      this.subOsc.start();

      // 2. Tire Scrub & Slide Synthesis (Smooth bandpass noise)
      const tireBufferSize = 2 * this.ctx.sampleRate;
      const tireBuffer = this.ctx.createBuffer(1, tireBufferSize, this.ctx.sampleRate);
      const tireData = tireBuffer.getChannelData(0);
      let lastVal = 0;
      for (let i = 0; i < tireBufferSize; i++) {
        const white = Math.random() * 2 - 1;
        tireData[i] = (lastVal + 0.02 * white) / 1.02; // Pink-ish noise
        lastVal = tireData[i];
      }

      const tireNoiseSource = this.ctx.createBufferSource();
      tireNoiseSource.buffer = tireBuffer;
      tireNoiseSource.loop = true;

      const tireFilter = this.ctx.createBiquadFilter();
      tireFilter.type = "bandpass";
      tireFilter.frequency.value = 1100;
      tireFilter.Q.value = 2.5;

      this.squealGain = this.ctx.createGain();
      this.squealGain.gain.value = 0.0;

      tireNoiseSource.connect(tireFilter);
      tireFilter.connect(this.squealGain);
      this.squealGain.connect(this.masterGain);
      tireNoiseSource.start();

      // 3. High-Speed Wind Rush Synthesis
      const bufferSize = 2 * this.ctx.sampleRate;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.frequency.value = 550;
      this.windFilter.Q.value = 1.0;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.0;

      whiteNoise.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      whiteNoise.start();

      this.isStarted = true;
    } catch (e) {
      console.warn("WebAudio not supported or blocked:", e);
    }
  }

  public resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  private carHarmonicMul: number = 3.0;
  private carToneFilterFreq: number = 240;

  public setCar(carId: string): void {
    if (carId === "weiss-blau-30") {
      this.carHarmonicMul = 3.0; // Straight-6 (3 firing pulses per rev)
      this.carToneFilterFreq = 260;
    } else if (carId === "lanzo-alta-4wd") {
      this.carHarmonicMul = 2.0; // 4-cylinder Turbo Group-A (2 pulses per rev)
      this.carToneFilterFreq = 340;
    } else if (carId === "pandino-4x4") {
      this.carHarmonicMul = 2.0; // Rugged 4-cylinder
      this.carToneFilterFreq = 220;
    } else if (carId === "alpe-a110") {
      this.carHarmonicMul = 2.2; // High-revving berlinetta
      this.carToneFilterFreq = 380;
    }
  }

  public update(rpm: number, throttle: number, isSliding: boolean, speedMs: number): void {
    if (!this.isStarted || !this.ctx || this.isMuted) return;

    const baseFreq = (rpm / 60) * this.carHarmonicMul;
    const now = this.ctx.currentTime;

    if (this.osc1 && this.osc2 && this.subOsc && this.filter && this.engineGain) {
      this.osc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
      this.osc2.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.04);
      this.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.04);

      // Lowpass cutoff opens smoothly with throttle and RPM
      const rpmNorm = Math.min(1.0, Math.max(0, (rpm - 800) / 6700));
      const targetCutoff = this.carToneFilterFreq + rpmNorm * 1100 + throttle * 1400;
      this.filter.frequency.setTargetAtTime(targetCutoff, now, 0.05);

      // Engine volume slightly louder on throttle
      const targetVol = 0.22 + throttle * 0.14 + rpmNorm * 0.10;
      this.engineGain.gain.setTargetAtTime(targetVol, now, 0.04);
    }

    // Smooth Tire Scrub / Squeal
    if (this.squealGain) {
      const squealTarget = isSliding && speedMs > 5.0 ? 0.28 : 0.0;
      this.squealGain.gain.setTargetAtTime(squealTarget, now, 0.06);
    }


    // Wind Rush Noise (scales with speed above 50 km/h / 14 m/s)
    if (this.windGain && this.windFilter) {
      const speedKmh = speedMs * 3.6;
      const windTarget = speedKmh > 50 ? Math.min(0.25, ((speedKmh - 50) / 130) * 0.25) : 0.0;
      this.windGain.gain.setTargetAtTime(windTarget, now, 0.1);
      this.windFilter.frequency.setTargetAtTime(400 + speedKmh * 6, now, 0.1);
    }
  }

  public playGearShift(isUpshift: boolean): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;

      // Transmission mechanical clunk
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(isUpshift ? 220 : 160, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);

      // Turbo blow-off / wastegate hiss on upshift
      if (isUpshift) {
        const noiseBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.18), this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.05));
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const bpf = this.ctx.createBiquadFilter();
        bpf.type = "bandpass";
        bpf.frequency.value = 2400;
        bpf.Q.value = 2.0;

        const hissGain = this.ctx.createGain();
        hissGain.gain.setValueAtTime(0.18, now);
        hissGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

        noise.connect(bpf);
        bpf.connect(hissGain);
        hissGain.connect(this.masterGain || this.ctx.destination);
        noise.start(now);
      }
    } catch {
      // ignore
    }
  }

  public playBackfirePop(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.07);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // ignore
    }
  }

  public playCountdownBeep(type: 'tick' | 'go'): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;

      osc.type = "sine";
      osc.frequency.value = type === 'go' ? 880 : 440; // High A5 for GO, A4 for tick

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (type === 'go' ? 0.45 : 0.2));

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch {
      // ignore
    }
  }

  public playCheckpointChime(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad

      notes.forEach((freq, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const noteTime = now + i * 0.08;

        osc.type = "sine";
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0.25, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + 0.4);
      });
    } catch {
      // ignore
    }
  }

  public playWallScrape(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      // ignore
    }
  }

  public reset(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      if (this.squealGain) {
        this.squealGain.gain.cancelScheduledValues(now);
        this.squealGain.gain.setValueAtTime(0.0, now);
      }
      if (this.windGain) {
        this.windGain.gain.cancelScheduledValues(now);
        this.windGain.gain.setValueAtTime(0.0, now);
      }
      if (this.engineGain) {
        this.engineGain.gain.cancelScheduledValues(now);
        this.engineGain.gain.setValueAtTime(0.0, now);
      }
      if (this.osc1 && this.osc2 && this.subOsc) {
        const baseFreq = (900 / 60) * this.carHarmonicMul;
        this.osc1.frequency.cancelScheduledValues(now);
        this.osc1.frequency.setValueAtTime(baseFreq, now);
        this.osc2.frequency.cancelScheduledValues(now);
        this.osc2.frequency.setValueAtTime(baseFreq * 2.0, now);
        this.subOsc.frequency.cancelScheduledValues(now);
        this.subOsc.frequency.setValueAtTime(baseFreq * 0.5, now);
      }
      if (this.filter) {
        this.filter.frequency.cancelScheduledValues(now);
        this.filter.frequency.setValueAtTime(this.carToneFilterFreq, now);
      }
    } catch {
      // ignore
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
    }
  }

  public destroy(): void {
    if (this.ctx) {
      this.ctx.close();
    }
  }
}

