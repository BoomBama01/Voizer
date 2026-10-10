/** Small signal-processing helpers shared by the detector and the visuals. */

export const ANALYSIS_SAMPLE_RATE = 16000;
export const FFT_SIZE = 1024;
export const FRAME_HOP = 512;

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function toDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

export function rms(samples: Float32Array, start: number, length: number): number {
  const end = Math.min(samples.length, start + length);
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/** Percentile of an unsorted array (linear interpolation, like numpy). */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = (n - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

let hannWindow: Float32Array | null = null;

export function hann(n: number): Float32Array {
  if (hannWindow && hannWindow.length === n) return hannWindow;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  hannWindow = w;
  return w;
}

/** Peak f0 in Hz from a Hann-windowed frame via normalised autocorrelation. */
export function estimatePitch(
  frame: Float32Array,
  sampleRate: number,
  minHz = 60,
  maxHz = 400,
): { f0: number; strength: number } {
  const n = frame.length;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));

  let energy = 0;
  for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
  if (energy <= 1e-9) return { f0: 0, strength: 0 };

  let bestLag = -1;
  let best = 0;
  const scores = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) sum += frame[i] * frame[i + lag];
    const norm = sum / (energy * (limit / n) + 1e-12);
    scores[lag] = norm;
    if (norm > best) {
      best = norm;
      bestLag = lag;
    }
  }

  if (bestLag < 0) return { f0: 0, strength: 0 };

  // Parabolic interpolation around the peak for sub-sample lag precision.
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = scores[bestLag - 1];
    const y1 = scores[bestLag];
    const y2 = scores[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) lag = bestLag + (0.5 * (y0 - y2)) / denom;
  }
  return { f0: sampleRate / lag, strength: best };
}

/** Convert a linear-frequency index range into Hz. */
export function binHz(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}
