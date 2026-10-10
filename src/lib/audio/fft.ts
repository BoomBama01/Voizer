/**
 * Minimal, dependency-free radix-2 FFT used by the VoiceShield signal backend.
 *
 * The analysis code must run both in the browser (for real user uploads) and
 * in Node (Vitest unit tests), so it deliberately avoids Web Audio APIs.
 */

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) {
      const angle = (-2 * Math.PI * i) / n;
      t.cos[i] = Math.cos(angle);
      t.sin[i] = Math.sin(angle);
    }
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place complex FFT. `re` and `im` must be the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const wr = cos[k];
        const wi = sin[k];
        const a = i + j;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/**
 * Magnitude spectrum of a real frame (Hann-windowed by the caller).
 * Writes `n/2 + 1` magnitudes into `out` and returns it.
 */
export function magnitudes(
  frame: Float32Array,
  out: Float64Array,
  re: Float64Array,
  im: Float64Array,
): Float64Array {
  const n = frame.length;
  for (let i = 0; i < n; i++) {
    re[i] = frame[i];
    im[i] = 0;
  }
  fft(re, im);
  const bins = n / 2 + 1;
  for (let k = 0; k < bins; k++) {
    out[k] = Math.hypot(re[k], im[k]);
  }
  return out;
}
