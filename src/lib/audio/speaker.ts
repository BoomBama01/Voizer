/**
 * Acoustic similarity ("same speaker?") without a neural speaker model.
 *
 * The embedding is a summary of the vocal-tract envelope and pitch: per-frame
 * log-mel band energies (0–4 kHz speech band) averaged and spread across the
 * clip, plus pitch statistics. Cosine similarity between two such vectors
 * separates the same person recorded in the same session from different
 * speakers well enough for an ownership challenge and a compare mode — and it
 * is honest about what it is: an acoustic-similarity heuristic, not a
 * d-vector speaker-embedding network.
 *
 * Used for:
 *  - the /clone ownership challenge (challenge clip vs. uploaded reference),
 *  - the /scan "same speaker?" compare mode.
 */

import { estimatePitch } from "./dsp";
import { fft } from "./fft";

const FRAME = 400; // 25 ms @ 16 kHz
const HOP = 160; // 10 ms
const FFT_SIZE = 512;
const MEL_BANDS = 20;
const HIGH_HZ = 4000;

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function melFilterbank(sampleRate: number): Array<{ lo: number; hi: number }> {
  const filters: Array<{ lo: number; hi: number }> = [];
  const lo = hzToMel(60);
  const hi = hzToMel(Math.min(HIGH_HZ, sampleRate / 2));
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    melToHz(lo + ((hi - lo) * i) / (MEL_BANDS + 1)),
  );
  for (let band = 0; band < MEL_BANDS; band++) {
    filters.push({ lo: points[band], hi: points[band + 2] });
  }
  return filters;
}

/**
 * Fixed-length speaker embedding (MEL_BANDS mean + spread + pitch stats).
 */
export function embedSpeaker(samples: Float32Array, sampleRate = 16000): Float32Array {
  const filters = melFilterbank(sampleRate);
  const sums = new Float64Array(MEL_BANDS);
  const sqSums = new Float64Array(MEL_BANDS);
  let frames = 0;
  let pitchSum = 0;
  let pitchSqSum = 0;
  let voiced = 0;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hann = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const value = samples[start + i];
      energy += value * value;
      re[i] = value * hann[i];
      im[i] = 0;
    }
    for (let i = FRAME; i < FFT_SIZE; i++) {
      re[i] = 0;
      im[i] = 0;
    }
    if (energy < 1e-8) continue;
    fft(re, im);

    for (let band = 0; band < MEL_BANDS; band++) {
      const { lo, hi } = filters[band];
      let acc = 0;
      const binLo = Math.max(1, Math.floor((lo / sampleRate) * FFT_SIZE));
      const binHi = Math.min(FFT_SIZE / 2, Math.ceil((hi / sampleRate) * FFT_SIZE));
      for (let bin = binLo; bin < binHi; bin++) {
        acc += re[bin] * re[bin] + im[bin] * im[bin];
      }
      const logEnergy = Math.log10(acc + 1e-9);
      sums[band] += logEnergy;
      sqSums[band] += logEnergy * logEnergy;
    }

    const { f0, strength } = estimatePitch(samples.subarray(start, start + FRAME), sampleRate);
    if (strength > 0.3 && f0 > 0) {
      voiced += 1;
      pitchSum += f0;
      pitchSqSum += f0 * f0;
    }
    frames += 1;
  }

  const embedding = new Float32Array(MEL_BANDS * 2 + 3);
  if (frames === 0) return embedding;
  for (let band = 0; band < MEL_BANDS; band++) {
    const mean = sums[band] / frames;
    const variance = Math.max(0, sqSans(sums, sqSums, band, frames));
    embedding[band] = mean;
    embedding[MEL_BANDS + band] = Math.sqrt(variance);
  }
  const voicedRatio = voiced / frames;
  const pitchMean = voiced > 0 ? pitchSum / voiced : 0;
  const pitchStd =
    voiced > 0 ? Math.sqrt(Math.max(0, pitchSqSum / voiced - pitchMean * pitchMean)) : 0;
  // Raw pitch values dwarf log-mel values; scale them into the same range.
  embedding[MEL_BANDS * 2] = pitchMean / 100;
  embedding[MEL_BANDS * 2 + 1] = pitchStd / 100;
  embedding[MEL_BANDS * 2 + 2] = voicedRatio;
  return embedding;
}

function sqSans(
  sums: Float64Array,
  sqSums: Float64Array,
  band: number,
  frames: number,
): number {
  return sqSums[band] / frames - (sums[band] / frames) ** 2;
}

/** Cosine similarity mapped from [-1, 1] to [0, 1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

export type SpeakerVerdict = "same" | "uncertain" | "different";

export interface SpeakerComparison {
  similarity: number;
  verdict: SpeakerVerdict;
  explanation: string;
}

/** Band thresholds chosen so "uncertain" absorbs the ambiguous middle. */
export const SPEAKER_THRESHOLDS = { same: 0.93, different: 0.8 } as const;

export function compareSpeakers(
  a: Float32Array,
  b: Float32Array,
  sampleRate = 16000,
): SpeakerComparison {
  const similarity = cosineSimilarity(embedSpeaker(a, sampleRate), embedSpeaker(b, sampleRate));
  const verdict: SpeakerVerdict =
    similarity >= SPEAKER_THRESHOLDS.same
      ? "same"
      : similarity < SPEAKER_THRESHOLDS.different
        ? "different"
        : "uncertain";
  const explanation =
    verdict === "same"
      ? `Acoustic similarity ${(similarity * 100).toFixed(1)}% — consistent with the same speaker in the same recording conditions.`
      : verdict === "different"
        ? `Acoustic similarity ${(similarity * 100).toFixed(1)}% — below the same-speaker range; treat as a different voice.`
        : `Acoustic similarity ${(similarity * 100).toFixed(1)}% sits in the ambiguous band. Similar voices, different microphones and heavy processing all land here; do not treat this as an identification.`;
  return { similarity, verdict, explanation };
}
