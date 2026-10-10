/**
 * Deterministic formant speech synthesiser used for the demo clips and the
 * detector's unit tests.
 *
 * The demo clips are *synthetic illustrations*, not recordings of real people:
 * `real` adds the artefacts a microphone actually captures (room tone, hum,
 * reverb, jitter, breath) while `clone` adds the artefacts neural vocoders and
 * aggressive post-processing leave behind (digital silence, a hard bandwidth
 * wall, unnaturally steady pitch, flat loudness).
 */

export type ClipKind = "real" | "clone" | "mixed";

export interface SynthOptions {
  seconds?: number;
  sampleRate?: number;
  seed?: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOWELS: Array<[number, number, number]> = [
  [730, 1090, 2440],
  [270, 2290, 3010],
  [300, 870, 2240],
  [530, 1840, 2480],
  [570, 840, 2410],
  [660, 1720, 2410],
];

class Resonator {
  private y1 = 0;
  private y2 = 0;
  private p1: number;
  private c: number;
  private a = 0;
  private b = 0;

  constructor(
    private freq: number,
    private bw: number,
    private sampleRate: number,
  ) {
    const t = 1 / sampleRate;
    this.p1 = 2 * Math.exp(-Math.PI * bw * t);
    this.c = -Math.exp(-2 * Math.PI * bw * t);
    this.setFreq(freq);
  }

  setFreq(freq: number) {
    this.freq = freq;
    this.b = this.p1 * Math.cos((2 * Math.PI * this.freq) / this.sampleRate);
    this.a = 1 - this.b - this.c;
  }

  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** One-pole low-pass used for the glottal spectral tilt. */
class OnePole {
  private z = 0;
  constructor(private a: number) {}
  process(x: number): number {
    this.z = this.z + this.a * (x - this.z);
    return this.z;
  }
}

interface SpeechContext {
  rnd: () => number;
  sampleRate: number;
  steadyPitch: boolean;
  jitter: number;
  shimmer: number;
}

function writeVoiced(
  out: Float32Array,
  start: number,
  count: number,
  f0: number,
  from: [number, number, number],
  to: [number, number, number],
  ctx: SpeechContext,
): number {
  const { rnd, sampleRate } = ctx;
  const f1 = new Resonator(from[0], 60, sampleRate);
  const f2 = new Resonator(from[1], 90, sampleRate);
  const f3 = new Resonator(from[2], 150, sampleRate);
  const tilt = new OnePole(1 - Math.exp((-2 * Math.PI * 2000) / sampleRate));

  let phase = 0;
  let period = sampleRate / f0;
  let gain = 1;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    f1.setFreq(from[0] + (to[0] - from[0]) * t);
    f2.setFreq(from[1] + (to[1] - from[1]) * t);
    f3.setFreq(from[2] + (to[2] - from[2]) * t);

    if (!ctx.steadyPitch) {
      period = (sampleRate / f0) * (0.94 + 0.12 * t) * (1 + (rnd() - 0.5) * ctx.jitter * 2);
    }
    phase += 1;
    let source = 0;
    if (phase >= period) {
      phase -= period;
      gain = 1 + (rnd() - 0.5) * ctx.shimmer;
      source = gain;
    }
    source += (rnd() - 0.5) * 0.08; // breath noise through the vocal tract
    const tilted = tilt.process(source);
    const v = f3.process(f2.process(f1.process(tilted)));
    const idx = start + i;
    if (idx < out.length) out[idx] += v;
  }
  return start + count;
}

function writeFricative(
  out: Float32Array,
  start: number,
  count: number,
  centerHz: number,
  bw: number,
  ctx: SpeechContext,
): number {
  const { rnd, sampleRate } = ctx;
  const band = new Resonator(centerHz, bw, sampleRate);
  for (let i = 0; i < count; i++) {
    const env = Math.sin((Math.PI * i) / count) ** 0.6;
    const v = band.process((rnd() - 0.5) * 2) * env * 0.9;
    const idx = start + i;
    if (idx < out.length) out[idx] += v;
  }
  return start + count;
}

/** Speech-like material: phrases of syllables with pauses between them. */
function generateSpeech(
  seconds: number,
  sampleRate: number,
  seed: number,
  steadyPitch: boolean,
): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const ctx: SpeechContext = {
    rnd,
    sampleRate,
    steadyPitch,
    jitter: steadyPitch ? 0 : 0.012,
    shimmer: steadyPitch ? 0 : 0.08,
  };

  let pos = Math.floor(rnd() * 0.15 * sampleRate);
  let prev: [number, number, number] = VOWELS[0];

  while (pos < out.length - Math.floor(0.4 * sampleRate)) {
    const syllables = 4 + Math.floor(rnd() * 4);
    const baseF0 = steadyPitch ? 125 : 100 + rnd() * 45;
    const phraseStart = pos;
    for (let s = 0; s < syllables; s++) {
      if (rnd() < 0.35) {
        const sibilant = rnd() < 0.6;
        pos = writeFricative(
          out,
          pos,
          Math.floor((0.05 + rnd() * 0.07) * sampleRate),
          sibilant ? 6000 : 2600,
          sibilant ? 2400 : 1300,
          ctx,
        );
      }
      const vowel = VOWELS[Math.floor(rnd() * VOWELS.length)];
      const progress = (pos - phraseStart) / (0.9 * sampleRate);
      const f0 = steadyPitch ? baseF0 : baseF0 * (1 - Math.min(0.18, progress * 0.12));
      const n = Math.floor((0.12 + rnd() * 0.13) * sampleRate);
      pos = writeVoiced(out, pos, n, f0, prev, vowel, ctx);
      prev = vowel;

      if (rnd() < 0.3) {
        pos += Math.floor((0.03 + rnd() * 0.03) * sampleRate); // closure
        pos = writeFricative(out, pos, Math.floor(0.006 * sampleRate), 3200, 3000, ctx);
      }
      pos += Math.floor((0.02 + rnd() * 0.05) * sampleRate); // inter-syllable gap
    }
    pos += Math.floor((0.32 + rnd() * 0.35) * sampleRate); // pause
  }
  return out;
}

function biquadLowpass(x: Float32Array, cutoff: number, sampleRate: number, sections = 4): Float32Array {
  const out = new Float32Array(x.length);
  out.set(x);
  const q = 0.7071;
  for (let s = 0; s < sections; s++) {
    const w0 = (2 * Math.PI * cutoff) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = (1 - Math.cos(w0)) / 2;
    const b1 = 1 - Math.cos(w0);
    const b2 = b0;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xv = out[i];
      const yv = (b0 / a0) * xv + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
      x2 = x1;
      x1 = xv;
      y2 = y1;
      y1 = yv;
      out[i] = yv;
    }
  }
  return out;
}

function processReal(dry: Float32Array, sampleRate: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(dry.length);

  // Slow hand-held / level variation.
  let envelope = 1;
  const envCoeff = 1 - Math.exp(-1 / (0.35 * sampleRate));
  for (let i = 0; i < dry.length; i++) {
    const target = 0.72 + 0.28 * ((rnd() + rnd() + rnd()) / 3) * 2;
    envelope += envCoeff * (target - envelope);
    out[i] = dry[i] * envelope;
  }

  // Room tone + mains hum across the whole recording (including pauses).
  let noiseZ = 0;
  const noiseCoeff = 1 - Math.exp((-2 * Math.PI * 1800) / sampleRate);
  for (let i = 0; i < out.length; i++) {
    noiseZ += noiseCoeff * ((rnd() - 0.5) * 2 - noiseZ);
    const t = i / sampleRate;
    const hum = Math.sin(2 * Math.PI * 50 * t) * 1.4e-3 + Math.sin(2 * Math.PI * 100 * t) * 5e-4;
    out[i] += noiseZ * 1.1e-2 + hum;
  }

  // Cheap multi-tap room reflections.
  const taps: Array<[number, number]> = [
    [Math.round(0.017 * sampleRate), 0.16],
    [Math.round(0.029 * sampleRate), 0.1],
    [Math.round(0.043 * sampleRate), 0.06],
  ];
  for (const [delay, gain] of taps) {
    for (let i = out.length - 1; i >= delay; i--) out[i] += out[i - delay] * gain;
  }

  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = 0.7 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

function processClone(dry: Float32Array, sampleRate: number): Float32Array {
  // Vocoder-style hard bandwidth wall just above the speech band.
  let out = biquadLowpass(dry, 6200, sampleRate, 4);

  // Heavy block-wise loudness normalisation (flat, lifeless dynamics).
  const block = Math.floor(0.15 * sampleRate);
  const targetRms = 10 ** (-19 / 20);
  const gains = new Float32Array(Math.ceil(out.length / block) + 1);
  for (let b = 0; b < gains.length; b++) {
    const start = b * block;
    let sum = 0;
    let n = 0;
    for (let i = start; i < Math.min(out.length, start + block); i++) {
      sum += out[i] * out[i];
      n++;
    }
    const r = n > 0 ? Math.sqrt(sum / n) : 0;
    gains[b] = r > 1e-5 ? Math.min(6, targetRms / r) : 1;
  }
  const normalised = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const b = Math.floor(i / block);
    const next = Math.min(gains.length - 1, b + 1);
    const frac = (i % block) / block;
    const g = gains[b] * (1 - frac) + gains[next] * frac;
    normalised[i] = out[i] * g;
  }
  out = normalised;

  // Digital silence: everything below the gate becomes an exact zero.
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i]) < 4e-4) out[i] = 0;
  }

  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = 0.7 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/**
 * Build one demo clip.
 *
 * - `real`  – microphone-like capture: room tone, hum, reflections, jitter.
 * - `clone` – vocoder-like render: bandwidth wall, gate, flat loudness, steady pitch.
 * - `mixed` – a natural first half and a cloned second half, which is what the
 *             sliding-window analysis is designed to catch.
 */
export function synthesizeClip(kind: ClipKind, options: SynthOptions = {}): Float32Array {
  const seconds = options.seconds ?? 12;
  const sampleRate = options.sampleRate ?? 16000;
  const seed = options.seed ?? 20261010;

  if (kind === "mixed") {
    const half = Math.floor((seconds / 2) * sampleRate);
    const natural = generateSpeech(seconds / 2, sampleRate, seed, false);
    const synthetic = generateSpeech(seconds / 2, sampleRate, seed + 977, true);
    const realHalf = processReal(natural, sampleRate, seed + 5);
    const cloneHalf = processClone(synthetic, sampleRate);
    const out = new Float32Array(half * 2);
    out.set(realHalf.subarray(0, half));
    out.set(cloneHalf.subarray(0, Math.min(half, cloneHalf.length)), half);
    return out;
  }

  const speech = generateSpeech(seconds, sampleRate, seed, kind === "clone");
  return kind === "clone" ? processClone(speech, sampleRate) : processReal(speech, sampleRate, seed + 5);
}
