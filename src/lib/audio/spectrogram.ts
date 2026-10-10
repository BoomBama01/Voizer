import { FFT_SIZE, FRAME_HOP, hann, toDb } from "./dsp";
import { magnitudes } from "./fft";

export interface Spectrogram {
  cols: number;
  rows: number;
  /** `cols * rows` values in dB (column-major: `data[col * rows + row]`). */
  data: Float32Array;
  minDb: number;
  maxDb: number;
  /** Seconds per column. */
  secPerCol: number;
  /** Upper frequency edge of the plot (Hz). */
  maxHz: number;
}

export interface SpectrogramOptions {
  cols?: number;
  rows?: number;
  minHz?: number;
}

/**
 * Down-samples the short-time spectrum into a fixed-size log-frequency image so
 * long recordings stay cheap to render.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  options: SpectrogramOptions = {},
): Spectrogram {
  const targetCols = options.cols ?? 1100;
  const rows = options.rows ?? 240;
  const minHz = options.minHz ?? 60;
  const maxHz = Math.min(8000, sampleRate / 2);
  const bins = FFT_SIZE / 2 + 1;
  const binWidth = sampleRate / FFT_SIZE;

  const frameCount = Math.max(1, Math.floor((samples.length - FFT_SIZE) / FRAME_HOP) + 1);
  const group = Math.max(1, Math.ceil(frameCount / targetCols));
  const cols = Math.max(1, Math.ceil(frameCount / group));
  const secPerCol = (group * FRAME_HOP) / sampleRate;

  // Log-spaced row boundaries mapped onto FFT bins.
  const rowStart = new Int32Array(rows + 1);
  for (let r = 0; r <= rows; r++) {
    const hz = minHz * Math.pow(maxHz / minHz, r / rows);
    rowStart[r] = Math.max(1, Math.min(bins - 1, Math.round(hz / binWidth)));
  }

  const data = new Float32Array(cols * rows);
  const window = hann(FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const mag = new Float64Array(bins);
  const work = new Float32Array(FFT_SIZE);
  const colCount = new Int32Array(cols);

  for (let f = 0; f < frameCount; f++) {
    const start = f * FRAME_HOP;
    for (let i = 0; i < FFT_SIZE; i++) work[i] = (samples[start + i] ?? 0) * window[i];
    magnitudes(work, mag, re, im);

    const col = Math.min(cols - 1, Math.floor(f / group));
    colCount[col]++;
    for (let r = 0; r < rows; r++) {
      const from = rowStart[r];
      const to = Math.max(from + 1, rowStart[r + 1]);
      let sum = 0;
      for (let k = from; k < to; k++) sum += mag[k] * mag[k];
      data[col * rows + r] += toDb(Math.sqrt(sum / (to - from)));
    }
  }

  let minDb = Infinity;
  let maxDb = -Infinity;
  for (let c = 0; c < cols; c++) {
    const n = Math.max(1, colCount[c]);
    for (let r = 0; r < rows; r++) {
      data[c * rows + r] /= n;
      const v = data[c * rows + r];
      if (v < minDb) minDb = v;
      if (v > maxDb) maxDb = v;
    }
  }
  if (!Number.isFinite(minDb)) minDb = -100;
  if (!Number.isFinite(maxDb)) maxDb = 0;

  return { cols, rows, data, minDb, maxDb, secPerCol, maxHz };
}

/** Min/max envelope for waveform drawing, `buckets` pairs wide. */
export function computePeaks(
  samples: Float32Array,
  buckets: number,
): Array<{ min: number; max: number }> {
  const size = Math.max(1, Math.floor(buckets));
  const per = Math.max(1, Math.floor(samples.length / size));
  const out: Array<{ min: number; max: number }> = [];
  for (let b = 0; b < size; b++) {
    const start = b * per;
    const end = Math.min(samples.length, start + per);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out.push({ min, max });
  }
  return out;
}
