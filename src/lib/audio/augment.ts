/**
 * Audio augmentations used for robustness testing.
 *
 * The detector must still catch synthetic speech after it has been through the
 * damage real-world shares inflict: lossy compression, telephone codecs, room
 * reverb and background noise. These transforms are deterministic (seeded LCG)
 * so evaluation runs are reproducible.
 *
 * The MP3 / phone transforms approximate the *audible* effect of the real
 * codecs (bandwidth limit + quantisation). `scripts/eval.mjs` uses real ffmpeg
 * encoders when they are installed and falls back to these simulations, and
 * docs/eval.md records which path produced each number.
 */

/** xorshift-free deterministic PRNG so runs are byte-identical. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function copyOf(samples: Float32Array): Float32Array {
  return new Float32Array(samples);
}

/** Add white noise at a target SNR (dB). */
export function addNoise(samples: Float32Array, snrDb: number, seed = 1): Float32Array {
  const out = copyOf(samples);
  let signalPower = 0;
  for (let i = 0; i < samples.length; i++) signalPower += samples[i] * samples[i];
  signalPower = signalPower / Math.max(1, samples.length) || 1e-12;
  const noisePower = signalPower / Math.pow(10, snrDb / 10);
  const scale = Math.sqrt(noisePower);
  const rng = makeRng(seed);
  for (let i = 0; i < out.length; i++) {
    // Box–Muller from two uniform draws.
    const u = Math.max(1e-9, rng());
    const v = rng();
    out[i] += scale * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return out;
}

/** Single biquad in transposed direct form II. */
function biquad(
  samples: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number,
): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

function bandpass(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number): Float32Array {
  const lo = biquadLowpass(samples, sampleRate, highHz);
  return biquadHighpass(lo, sampleRate, lowHz);
}

function biquadLowpass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const w0 = (2 * Math.PI * Math.min(cutoffHz, sampleRate / 2 - 100)) / sampleRate;
  const alpha = Math.sin(w0) / 2;
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  return biquad(
    samples,
    ((1 - cosw) / 2) / a0,
    (1 - cosw) / a0,
    ((1 - cosw) / 2) / a0,
    (-2 * cosw) / a0,
    (1 - alpha) / a0,
  );
}

function biquadHighpass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const w0 = (2 * Math.PI * Math.max(20, cutoffHz)) / sampleRate;
  const alpha = Math.sin(w0) / 2;
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  return biquad(
    samples,
    ((1 + cosw) / 2) / a0,
    -(1 + cosw) / a0,
    ((1 + cosw) / 2) / a0,
    (-2 * cosw) / a0,
    (1 - alpha) / a0,
  );
}

/**
 * Telephone network simulation: 300–3400 Hz band, 8 kHz decimation and mild
 * quantisation to 8 bit — the classic narrowband call path.
 */
export function simulatePhone(samples: Float32Array, sampleRate = 16000): Float32Array {
  const filtered = bandpass(samples, sampleRate, 300, 3400);
  const step = Math.max(1, Math.round(sampleRate / 8000));
  const decimated = new Float32Array(Math.ceil(filtered.length / step));
  for (let i = 0; i < decimated.length; i++) decimated[i] = filtered[i * step];
  return quantize(decimated, 8);
}

/**
 * Lossy-codec simulation: high-frequency roll-off (the MP3 "cutoff wall"),
 * blocky spectral quantisation and a touch of pre-echo smear.
 */
export function simulateLossy(samples: Float32Array, sampleRate = 16000): Float32Array {
  const rolled = biquadLowpass(samples, sampleRate, 14000);
  const quantised = quantize(rolled, 6);
  // Pre-echo: smear each 512-sample block backwards by a few percent.
  const out = copyOf(quantised);
  const block = 512;
  for (let start = 0; start + block <= out.length; start += block) {
    for (let i = 0; i < 32; i++) {
      const idx = start + i;
      const forward = out[start + i + 32] ?? 0;
      out[idx] = out[idx] * 0.85 + forward * 0.15;
    }
  }
  return out;
}

function quantize(samples: Float32Array, bits: number): Float32Array {
  const levels = Math.pow(2, bits) - 1;
  const out = copyOf(samples);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(((out[i] + 1) / 2) * levels) / levels * 2 - 1;
  }
  return out;
}

/** Schroeder reverb: four combs into two all-passes, RT60-controlled. */
export function simulateReverb(
  samples: Float32Array,
  sampleRate: number,
  rt60Sec = 0.6,
): Float32Array {
  const scale = sampleRate / 44100;
  const combDelays = [1557, 1617, 1491, 1422].map((d) => Math.max(16, Math.round(d * scale)));
  const out = copyOf(samples);

  for (const delay of combDelays) {
    const g = Math.pow(10, (-3 * delay) / (rt60Sec * sampleRate));
    const buf = new Float32Array(delay);
    let pos = 0;
    for (let i = 0; i < samples.length; i++) {
      const y = buf[pos];
      buf[pos] = samples[i] + y * g;
      out[i] += y * 0.25;
      pos = (pos + 1) % delay;
    }
  }

  for (const delay of [225, 556].map((d) => Math.max(8, Math.round(d * scale)))) {
    const g = 0.5;
    const buf = new Float32Array(delay);
    let pos = 0;
    for (let i = 0; i < out.length; i++) {
      const bufOut = buf[pos];
      const input = out[i];
      buf[pos] = input + bufOut * g;
      out[i] = bufOut - input * g;
      pos = (pos + 1) % delay;
    }
  }

  return out;
}

/** Gain change in dB — trivial but catches absolute-threshold bugs. */
export function applyGain(samples: Float32Array, gainDb: number): Float32Array {
  const factor = Math.pow(10, gainDb / 20);
  const out = copyOf(samples);
  for (let i = 0; i < out.length; i++) out[i] *= factor;
  return out;
}

export type AugmentationId = "clean" | "mp3" | "phone" | "noise" | "reverb" | "phone+noise";

export const AUGMENTATIONS: Record<AugmentationId, (samples: Float32Array) => Float32Array> = {
  clean: (s) => copyOf(s),
  mp3: (s) => simulateLossy(s),
  phone: (s) => simulatePhone(s),
  noise: (s) => addNoise(s, 15, 7),
  reverb: (s) => simulateReverb(s, 16000, 0.7),
  "phone+noise": (s) => addNoise(simulatePhone(s), 10, 11),
};
