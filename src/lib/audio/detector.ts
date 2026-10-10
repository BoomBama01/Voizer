import { ANALYSIS_SAMPLE_RATE, clamp, sigmoid } from "./dsp";
import { extractSegmentFeatures, type SegmentFeatures } from "./features";

export type Verdict = "ai" | "partial" | "uncertain" | "real";
export type SegmentVerdict = "ai" | "uncertain" | "real";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface FeatureContribution {
  key: string;
  label: string;
  /** 0..1 evidence that the audio is synthetic (0.5 = uninformative). */
  evidence: number;
  /** Signed pull on the final score: positive = synthetic, negative = human. */
  contribution: number;
  detail: string;
}

export interface SegmentResult {
  index: number;
  startSec: number;
  endSec: number;
  /** 0..100 probability that this window is synthetic. */
  probability: number;
  verdict: SegmentVerdict;
  silent: boolean;
  features: SegmentFeatures;
}

export interface AnalysisResult {
  model: string;
  durationSec: number;
  sampleRate: number;
  /** Calibrated 0..100 probability that the clip is AI-generated. */
  probability: number;
  verdict: Verdict;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  segments: SegmentResult[];
  flaggedSegments: number[];
  peakSegmentIndex: number;
  mixedContent: boolean;
  reasons: FeatureContribution[];
  notes: string[];
  analyzedAt: string;
}

/**
 * Tunable detector configuration.
 *
 * `temperature` implements the temperature-scaling calibration step described
 * in docs/MODEL_CARD.md: raw logits are divided by T before the sigmoid so the
 * reported probability matches observed precision on held-out data.
 */
export const DETECTOR_PARAMS = {
  windowSec: 4,
  hopSec: 2,
  uncertainLow: 40,
  uncertainHigh: 60,
  flagSegment: 65,
  silencePeakDb: -60,
  temperature: 1.15,
  peakBlend: 0.25,
  mixedGap: 25,
  weights: {
    noiseFloor: 1.35,
    digitalSilence: 1.1,
    bandwidth: 1.15,
    bandEdge: 1.05,
    pitchStability: 0.7,
    spectralSmoothness: 0.4,
    highBand: 0.7,
    sibilanceFlatness: 0.7,
  },
} as const;

const LABELS: Record<string, string> = {
  noiseFloor: "Room tone / noise floor",
  digitalSilence: "Digital silence in pauses",
  bandwidth: "Truncated bandwidth",
  bandEdge: "Hard spectral cliff",
  pitchStability: "Pitch stability",
  spectralSmoothness: "Spectral smoothness",
  highBand: "Sibilance energy > 6 kHz",
  sibilanceFlatness: "Sibilance-band texture",
};

function clamp01(v: number) {
  return clamp(v, 0, 1);
}

interface Evidence {
  key: string;
  evidence: number;
  weight: number;
  detail: string;
}

function collectEvidence(f: SegmentFeatures): Evidence[] {
  const bandwidthWeight = f.narrowband ? 0.3 : 1;
  const hasPitch = f.voicedFraction >= 0.12 && f.pitchMedianHz > 0;

  return [
    {
      key: "noiseFloor",
      evidence: clamp01((f.snrDb - 46) / 24),
      weight: DETECTOR_PARAMS.weights.noiseFloor,
      detail:
        f.snrDb >= 46
          ? `Quiet passages sit ${f.snrDb.toFixed(0)} dB below speech — a noise floor that low is almost never captured by a microphone.`
          : `Room tone is present: quiet passages are ${f.snrDb.toFixed(0)} dB below speech level, as a real microphone would record.`,
    },
    {
      key: "digitalSilence",
      evidence: clamp01((f.zeroRatio - 0.25) / 0.45),
      weight: DETECTOR_PARAMS.weights.digitalSilence,
      detail:
        f.zeroRatio > 0.25
          ? `${(f.zeroRatio * 100).toFixed(0)}% of the samples in quiet passages are exact digital zeros.`
          : `No digital-zero gaps: ${(f.zeroRatio * 100).toFixed(0)}% of quiet samples sit at true zero.`,
    },
    {
      key: "bandwidth",
      evidence: clamp01((7000 - f.f995Hz) / 2200) * bandwidthWeight + 0.5 * (1 - bandwidthWeight),
      weight: DETECTOR_PARAMS.weights.bandwidth,
      detail: f.narrowband
        ? `Narrowband telephone channel detected near ${f.phoneEdgeHz.toFixed(0)} Hz — bandwidth cues are unreliable here.`
        : `99.5% of the energy ends at ${f.f995Hz.toFixed(0)} Hz${f.f995Hz < 7000 ? ", short of the 7–8 kHz sibilance band a microphone captures." : ", which covers the full speech band."}`,
    },
    {
      key: "bandEdge",
      evidence:
        f.edgeHz >= 4500 ? clamp01((f.edgeDropDb - 10) / 20) * bandwidthWeight + 0.5 * (1 - bandwidthWeight) : 0.5,
      weight: DETECTOR_PARAMS.weights.bandEdge,
      detail:
        f.edgeHz >= 4500 && f.edgeDropDb >= 10
          ? `A ${f.edgeDropDb.toFixed(0)} dB energy cliff appears at ${f.edgeHz.toFixed(0)} Hz — a bandwidth wall typical of vocoders and codecs.`
          : "Energy rolls off gradually above 4.5 kHz, with no hard bandwidth wall.",
    },
    {
      key: "pitchStability",
      evidence: hasPitch ? clamp01((3 - f.pitchStdSemis) / 2.2) : 0.5,
      weight: DETECTOR_PARAMS.weights.pitchStability,
      detail: hasPitch
        ? `Pitch drifts only ${f.pitchStdSemis.toFixed(1)} semitones across the window${f.pitchStdSemis < 3 ? " — steadier than natural intonation." : ", which is a natural range."}`
        : "Not enough voiced speech to measure pitch stability.",
    },
    {
      key: "spectralSmoothness",
      evidence: clamp01((12.5 - f.flux) / 5),
      weight: DETECTOR_PARAMS.weights.spectralSmoothness,
      detail:
        f.flux < 12.5
          ? `Frame-to-frame spectral movement averages ${f.flux.toFixed(1)} dB — smoother than spontaneous speech.`
          : `Spectral movement averages ${f.flux.toFixed(1)} dB per frame, typical of spontaneous speech.`,
    },
    {
      key: "highBand",
      evidence: clamp01((0.06 - f.hfRatio) / 0.05) * bandwidthWeight + 0.5 * (1 - bandwidthWeight),
      weight: DETECTOR_PARAMS.weights.highBand,
      detail:
        f.hfRatio < 0.06
          ? `Only ${(f.hfRatio * 100).toFixed(1)}% of the energy lives above 6 kHz — sibilants look damped.`
          : `${(f.hfRatio * 100).toFixed(1)}% of the energy lives above 6 kHz, a healthy sibilance band.`,
    },
    {
      key: "sibilanceFlatness",
      evidence: clamp01((0.45 - f.flatnessHigh) / 0.25) * bandwidthWeight + 0.5 * (1 - bandwidthWeight),
      weight: DETECTOR_PARAMS.weights.sibilanceFlatness,
      detail:
        f.flatnessHigh < 0.45
          ? `The 5–8 kHz band has a shaped, noisy texture (flatness ${f.flatnessHigh.toFixed(2)}) like real sibilance.`
          : `The 5–8 kHz band is unusually tonal or hollow (flatness ${f.flatnessHigh.toFixed(2)}).`,
    },
  ];
}

/** Log-odds for one window, before temperature scaling. */
export function segmentLogit(f: SegmentFeatures): number {
  let z = 0;
  for (const item of collectEvidence(f)) z += item.weight * (2 * item.evidence - 1);
  return z;
}

export function segmentContributions(f: SegmentFeatures): FeatureContribution[] {
  return collectEvidence(f).map((item) => ({
    key: item.key,
    label: LABELS[item.key] ?? item.key,
    evidence: item.evidence,
    contribution: item.weight * (2 * item.evidence - 1),
    detail: item.detail,
  }));
}

/** Calibrated probability (0..100) that this window is synthetic. */
export function scoreSegment(f: SegmentFeatures): number {
  const z = segmentLogit(f) / DETECTOR_PARAMS.temperature;
  return clamp01(sigmoid(z)) * 100;
}

export function verdictFor(probability: number): SegmentVerdict {
  if (probability >= DETECTOR_PARAMS.uncertainHigh) return "ai";
  if (probability < DETECTOR_PARAMS.uncertainLow) return "real";
  return "uncertain";
}

export function confidenceFor(probability: number): { value: number; level: ConfidenceLevel } {
  const value = clamp01(Math.abs(probability - 50) / 40) * 100;
  const level: ConfidenceLevel = value < 35 ? "low" : value < 70 ? "medium" : "high";
  return { value, level };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildResult(
  segments: SegmentResult[],
  durationSec: number,
  sampleRate: number,
): AnalysisResult {
  const active = segments.filter((s) => !s.silent);
  const pool = active.length > 0 ? active : segments;
  const meanP = pool.reduce((a, s) => a + s.probability, 0) / pool.length;
  const peak = pool.reduce((a, s) => (s.probability > a.probability ? s : a), pool[0]);
  const probability = clamp01(
    (1 - DETECTOR_PARAMS.peakBlend) * (meanP / 100) + DETECTOR_PARAMS.peakBlend * (peak.probability / 100),
  ) * 100;

  const flaggedSegments = segments
    .filter((s) => !s.silent && s.probability >= DETECTOR_PARAMS.flagSegment)
    .map((s) => s.index);
  const mixedContent =
    peak.probability - meanP >= DETECTOR_PARAMS.mixedGap &&
    meanP < DETECTOR_PARAMS.uncertainHigh &&
    peak.probability >= DETECTOR_PARAMS.flagSegment;

  const verdict: Verdict = mixedContent ? "partial" : verdictFor(probability);
  const { value: rawConfidence, level: confidenceLevel } = confidenceFor(probability);
  const confidence =
    verdict === "partial" && active.length > 0
      ? clamp01(
          active.reduce((a, s) => a + Math.abs(s.probability - 50) / 40, 0) / active.length,
        ) * 100
      : rawConfidence;

  // Aggregate per-feature contributions across active windows.
  const totals = new Map<string, { label: string; evidence: number; contribution: number; detail: string; n: number }>();
  for (const seg of active.length > 0 ? active : segments) {
    for (const c of segmentContributions(seg.features)) {
      const entry = totals.get(c.key) ?? {
        label: c.label,
        evidence: 0,
        contribution: 0,
        detail: c.detail,
        n: 0,
      };
      entry.evidence += c.evidence;
      entry.contribution += c.contribution;
      entry.n++;
      totals.set(c.key, entry);
    }
  }
  const reasons = Array.from(totals.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      evidence: v.evidence / v.n,
      contribution: v.contribution / v.n,
      detail: v.detail,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const notes: string[] = [];
  if (segments.some((s) => s.features.narrowband)) {
    notes.push(
      "Narrowband telephone channel detected (≈3.4 kHz). Bandwidth-based cues are down-weighted; rely more on the noise-floor and scam-script signals.",
    );
  }
  if (mixedContent) {
    notes.push(
      "Mixed content: some 4-second windows look synthesized while others look natural — consistent with a partially cloned or spliced recording.",
    );
  }
  if (active.length === 0) {
    notes.push("The clip is essentially silent; no usable speech was found.");
  }
  if (durationSec < DETECTOR_PARAMS.windowSec) {
    notes.push(
      `The clip is shorter than the ${DETECTOR_PARAMS.windowSec}s analysis window, so segment statistics are less stable.`,
    );
  }

  return {
    model: "vsa-heuristic-0.1",
    durationSec,
    sampleRate,
    probability,
    verdict,
    confidence,
    confidenceLevel,
    segments,
    flaggedSegments,
    peakSegmentIndex: peak.index,
    mixedContent,
    reasons: reasons.slice(0, 5),
    notes,
    analyzedAt: new Date().toISOString(),
  };
}

/** Synchronous analysis of a 16 kHz mono buffer. Used by tests and the UI. */
export function analyzeSignal(
  samples: Float32Array,
  sampleRate: number = ANALYSIS_SAMPLE_RATE,
): AnalysisResult {
  const durationSec = samples.length / sampleRate;
  const windowSamples = Math.round(DETECTOR_PARAMS.windowSec * sampleRate);
  const hopSamples = Math.round(DETECTOR_PARAMS.hopSec * sampleRate);

  const segments: SegmentResult[] = [];
  if (samples.length <= windowSamples) {
    const features = extractSegmentFeatures(samples, sampleRate);
    const silent = features.peakDb < DETECTOR_PARAMS.silencePeakDb;
    const probability = silent ? 50 : scoreSegment(features);
    segments.push({
      index: 0,
      startSec: 0,
      endSec: durationSec,
      probability,
      verdict: verdictFor(probability),
      silent,
      features,
    });
  } else {
    let index = 0;
    for (let start = 0; start + windowSamples <= samples.length; start += hopSamples) {
      const slice = samples.subarray(start, start + windowSamples);
      const features = extractSegmentFeatures(slice, sampleRate);
      const silent = features.peakDb < DETECTOR_PARAMS.silencePeakDb;
      const probability = silent ? 50 : scoreSegment(features);
      segments.push({
        index: index++,
        startSec: start / sampleRate,
        endSec: (start + windowSamples) / sampleRate,
        probability,
        verdict: verdictFor(probability),
        silent,
        features,
      });
      if (start + hopSamples + windowSamples > samples.length) break;
    }
  }

  return buildResult(segments, durationSec, sampleRate);
}

/** Async variant that reports progress and yields to the UI between windows. */
export async function analyzeSignalAsync(
  samples: Float32Array,
  sampleRate: number = ANALYSIS_SAMPLE_RATE,
  onProgress?: (fraction: number) => void,
): Promise<AnalysisResult> {
  const durationSec = samples.length / sampleRate;
  const windowSamples = Math.round(DETECTOR_PARAMS.windowSec * sampleRate);
  const hopSamples = Math.round(DETECTOR_PARAMS.hopSec * sampleRate);
  const total = Math.max(1, Math.ceil((samples.length - windowSamples) / hopSamples) + 1);

  const segments: SegmentResult[] = [];
  let index = 0;
  for (let start = 0; start + windowSamples <= samples.length; start += hopSamples) {
    const slice = samples.subarray(start, start + windowSamples);
    const features = extractSegmentFeatures(slice, sampleRate);
    const silent = features.peakDb < DETECTOR_PARAMS.silencePeakDb;
    const probability = silent ? 50 : scoreSegment(features);
    segments.push({
      index: index++,
      startSec: start / sampleRate,
      endSec: (start + windowSamples) / sampleRate,
      probability,
      verdict: verdictFor(probability),
      silent,
      features,
    });
    onProgress?.(Math.min(0.98, segments.length / total));
    await yieldToUi();
    if (start + hopSamples + windowSamples > samples.length) break;
  }

  if (segments.length === 0) {
    const features = extractSegmentFeatures(samples, sampleRate);
    const silent = features.peakDb < DETECTOR_PARAMS.silencePeakDb;
    const probability = silent ? 50 : scoreSegment(features);
    segments.push({
      index: 0,
      startSec: 0,
      endSec: durationSec,
      probability,
      verdict: verdictFor(probability),
      silent,
      features,
    });
  }

  onProgress?.(1);
  return buildResult(segments, durationSec, sampleRate);
}
