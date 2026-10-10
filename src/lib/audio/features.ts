import {
  ANALYSIS_SAMPLE_RATE,
  FFT_SIZE,
  FRAME_HOP,
  binHz,
  estimatePitch,
  hann,
  percentile,
  rms,
  toDb,
} from "./dsp";
import { magnitudes } from "./fft";

/**
 * Features measured on one analysis window (a 4-second sliding slice).
 *
 * Every feature is a cue that has been observed to differ between natural
 * recordings and neural speech synthesis / voice-cloned audio:
 *
 * - `snrDb` / `zeroRatio`  – real rooms have a noise floor; generated audio
 *                            often has digital silence between phrases.
 * - `f995Hz` / `edgeDropDb` – vocoder bandwidth limits leave a hard spectral
 *                            cliff that microphones never produce.
 * - `pitchStdSemis`        – human intonation drifts; heavy vocoding flattens it.
 * - `flux`                 – frame-to-frame spectral movement.
 * - `hfRatio`              – missing sibilance energy above ~6 kHz.
 */
export interface SegmentFeatures {
  frameCount: number;
  durationSec: number;
  peakDb: number;
  noiseFloorDb: number;
  snrDb: number;
  zeroRatio: number;
  hfRatio: number;
  f995Hz: number;
  edgeDropDb: number;
  edgeHz: number;
  phoneEdgeHz: number;
  pitchMedianHz: number;
  pitchStdSemis: number;
  voicedFraction: number;
  flux: number;
  flatnessHigh: number;
  narrowband: boolean;
}

const DB_FLOOR = -90;

function movingAverage(values: Float64Array, radius: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

/** Strongest downward spectral cliff inside `[minHz, maxHz]` over a 250 Hz span. */
function findEdge(
  db: Float64Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): { dropDb: number; hz: number } {
  const bins = db.length;
  const spanBins = Math.max(4, Math.round((250 * FFT_SIZE) / sampleRate));
  const startBin = Math.max(1, Math.ceil((minHz * FFT_SIZE) / sampleRate));
  const endBin = Math.min(bins - spanBins - 1, Math.floor((maxHz * FFT_SIZE) / sampleRate));
  let bestDrop = 0;
  let bestHz = 0;
  for (let i = startBin; i <= endBin; i++) {
    const drop = db[i] - db[i + spanBins];
    if (drop > bestDrop) {
      bestDrop = drop;
      bestHz = binHz(i, FFT_SIZE, sampleRate);
    }
  }
  return { dropDb: bestDrop, hz: bestHz };
}

export function extractSegmentFeatures(
  samples: Float32Array,
  sampleRate: number = ANALYSIS_SAMPLE_RATE,
): SegmentFeatures {
  const frameCount = Math.max(1, Math.floor((samples.length - FFT_SIZE) / FRAME_HOP) + 1);
  const bins = FFT_SIZE / 2 + 1;
  const window = hann(FFT_SIZE);

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const mag = new Float64Array(bins);
  const frameDb = new Float64Array(frameCount);
  const power = new Float64Array(frameCount * bins);
  const work = new Float32Array(FFT_SIZE);

  for (let f = 0; f < frameCount; f++) {
    const start = f * FRAME_HOP;
    frameDb[f] = Math.max(-100, toDb(rms(samples, start, FFT_SIZE)));
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[start + i] ?? 0;
      work[i] = s * window[i];
    }
    magnitudes(work, mag, re, im);
    for (let k = 0; k < bins; k++) power[f * bins + k] = mag[k] * mag[k];
  }

  const peakDb = percentile(frameDb, 0.9);
  const noiseFloorDb = percentile(frameDb, 0.1);
  const snrDb = peakDb - noiseFloorDb;
  const speechThreshold = Math.max(peakDb - 30, -75);

  const speechFrames: number[] = [];
  for (let f = 0; f < frameCount; f++) if (frameDb[f] >= speechThreshold) speechFrames.push(f);
  if (speechFrames.length === 0) speechFrames.push(frameDb.indexOf(peakDb));

  // Aggregate spectrum over speech frames.
  const aggregate = new Float64Array(bins);
  for (const f of speechFrames) {
    const offset = f * bins;
    for (let k = 0; k < bins; k++) aggregate[k] += power[offset + k];
  }

  let totalEnergy = 0;
  for (let k = 1; k < bins; k++) totalEnergy += aggregate[k];
  const eps = 1e-20;

  // hfRatio: 6 kHz..Nyquist share of 200 Hz..Nyquist energy.
  const hfStart = Math.ceil((6000 * FFT_SIZE) / sampleRate);
  const refStart = Math.ceil((200 * FFT_SIZE) / sampleRate);
  let hfEnergy = 0;
  let refEnergy = 0;
  for (let k = refStart; k < bins; k++) {
    refEnergy += aggregate[k];
    if (k >= hfStart) hfEnergy += aggregate[k];
  }
  const hfRatio = refEnergy > 0 ? hfEnergy / refEnergy : 0;

  // f995: frequency below which 99.5% of the energy sits.
  const floorBin = Math.ceil((100 * FFT_SIZE) / sampleRate);
  let running = 0;
  let f995Hz = binHz(bins - 1, FFT_SIZE, sampleRate);
  const target = (totalEnergy - eps * bins) * 0.995;
  for (let k = floorBin; k < bins; k++) {
    running += aggregate[k];
    if (running >= target) {
      f995Hz = binHz(k, FFT_SIZE, sampleRate);
      break;
    }
  }

  const aggDb = new Float64Array(bins);
  for (let k = 0; k < bins; k++) aggDb[k] = toDb(Math.sqrt(aggregate[k] / speechFrames.length));
  const smooth = movingAverage(aggDb, 3);

  const highEdge = findEdge(smooth, sampleRate, 4500, 7900);
  const phoneEdge = findEdge(smooth, sampleRate, 2600, 4400);

  const abovePhoneStart = Math.ceil((4600 * FFT_SIZE) / sampleRate);
  let abovePhone = 0;
  for (let k = abovePhoneStart; k < bins; k++) abovePhone += aggregate[k];
  const highBandRatio = refEnergy > 0 ? abovePhone / refEnergy : 0;
  const narrowband =
    phoneEdge.dropDb >= 16 && phoneEdge.hz > 2600 && phoneEdge.hz < 4300 && highBandRatio < 0.04;

  // Pitch stability across voiced frames (sampled every 4th frame for speed).
  const pitchHz: number[] = [];
  let voiced = 0;
  let considered = 0;
  for (let i = 0; i < speechFrames.length; i += 4) {
    const start = speechFrames[i] * FRAME_HOP;
    considered++;
    for (let j = 0; j < FFT_SIZE; j++) work[j] = samples[start + j] ?? 0;
    const { f0, strength } = estimatePitch(work, sampleRate);
    if (strength > 0.4 && f0 > 0) {
      voiced++;
      pitchHz.push(f0);
    }
  }
  let pitchMedianHz = 0;
  let pitchStdSemis = 0;
  if (pitchHz.length >= 3) {
    pitchMedianHz = percentile(pitchHz, 0.5);
    const semis = pitchHz.map((f) => 12 * Math.log2(f / pitchMedianHz));
    const mean = semis.reduce((a, b) => a + b, 0) / semis.length;
    const variance = semis.reduce((a, b) => a + (b - mean) ** 2, 0) / semis.length;
    pitchStdSemis = Math.sqrt(variance);
  }

  // Spectral flux: mean absolute frame-to-frame dB change.
  let fluxTotal = 0;
  let fluxPairs = 0;
  const fluxStart = refStart;
  for (let i = 1; i < speechFrames.length; i++) {
    const a = speechFrames[i - 1] * bins;
    const b = speechFrames[i] * bins;
    if (speechFrames[i] - speechFrames[i - 1] > 3) continue;
    let acc = 0;
    let count = 0;
    for (let k = fluxStart; k < bins; k++) {
      const pa = Math.sqrt(power[a + k]);
      const pb = Math.sqrt(power[b + k]);
      if (pa < 1e-6 && pb < 1e-6) continue;
      acc += Math.abs(toDb(pa + eps) - toDb(pb + eps));
      count++;
    }
    if (count > 0) {
      fluxTotal += acc / count;
      fluxPairs++;
    }
  }
  const flux = fluxPairs > 0 ? fluxTotal / fluxPairs : 0;

  // Spectral flatness (geometric / arithmetic mean) in the 5–8 kHz band.
  const flatStart = Math.ceil((5000 * FFT_SIZE) / sampleRate);
  let flatSum = 0;
  let flatCount = 0;
  for (const f of speechFrames) {
    const offset = f * bins;
    let logSum = 0;
    let linSum = 0;
    let n = 0;
    for (let k = flatStart; k < bins; k++) {
      const p = power[offset + k] + eps;
      logSum += Math.log(p);
      linSum += p;
      n++;
    }
    if (n === 0 || linSum <= 0) continue;
    flatSum += Math.exp(logSum / n) / (linSum / n);
    flatCount++;
  }
  const flatnessHigh = flatCount > 0 ? flatSum / flatCount : 0;

  // Digital-silence ratio inside the quietest quarter of frames.
  const quietCount = Math.max(1, Math.floor(frameCount * 0.25));
  const order = Array.from(frameDb.keys()).sort((a, b) => frameDb[a] - frameDb[b]);
  let zeros = 0;
  let quietSamples = 0;
  for (let i = 0; i < quietCount; i++) {
    const start = order[i] * FRAME_HOP;
    for (let j = 0; j < FFT_SIZE; j++) {
      const s = samples[start + j] ?? 0;
      quietSamples++;
      if (Math.abs(s) < 1e-5) zeros++;
    }
  }
  const zeroRatio = quietSamples > 0 ? zeros / quietSamples : 0;

  return {
    frameCount,
    durationSec: samples.length / sampleRate,
    peakDb,
    noiseFloorDb,
    snrDb,
    zeroRatio,
    hfRatio,
    f995Hz,
    edgeDropDb: highEdge.dropDb,
    edgeHz: highEdge.hz,
    phoneEdgeHz: phoneEdge.hz,
    pitchMedianHz,
    pitchStdSemis,
    voicedFraction: considered > 0 ? voiced / considered : 0,
    flux,
    flatnessHigh,
    narrowband,
  };
}
