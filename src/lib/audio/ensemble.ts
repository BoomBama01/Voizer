import {
  composeAnalysisResult,
  verdictFor,
  type AnalysisResult,
  type SegmentResult,
  type SegmentVerdict,
} from "./detector";

/** One 4-second window as scored by the learned model. */
export interface LearnedWindow {
  startSec: number;
  endSec: number;
  /** 0–100 probability that the window is synthetic. */
  probability: number;
}

/** Result returned by the anti-spoofing backend (see src/lib/server/provider.ts). */
export interface LearnedModelResult {
  available: boolean;
  modelId: string;
  license?: string;
  /** Clip-level probability (0–100). */
  globalProbability: number;
  windows: LearnedWindow[];
  latencyMs?: number;
  /** Why the model could not run (configuration, network, provider error). */
  reason?: string;
}

export interface EnsembleConfig {
  learnedWeight: number;
  heuristicWeight: number;
  /** Widened uncertainty band used only when a learned score is present. */
  uncertainLow: number;
  uncertainHigh: number;
  flagSegment: number;
}

/**
 * The learned model is the primary signal (0.75); the heuristic keeps 0.25
 * because it is the only cue available when the model is unreachable and
 * because it is computed per sliding window, which is what preserves the
 * partially-synthetic verdict.
 *
 * Bands are wider than the heuristic-only 40–60: with two imperfect scorers we
 * would rather answer "uncertain" than guess. Tuning evidence: docs/eval.md.
 */
export const ENSEMBLE_PARAMS: EnsembleConfig = {
  learnedWeight: 0.75,
  heuristicWeight: 0.25,
  uncertainLow: 30,
  uncertainHigh: 70,
  flagSegment: 70,
};

/** Blend a learned score with the heuristic score for the same span. */
export function blendScores(
  learned: number,
  heuristic: number,
  config: EnsembleConfig = ENSEMBLE_PARAMS,
): number {
  const clamp = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v);
  return clamp(
    config.learnedWeight * clamp(learned) + config.heuristicWeight * clamp(heuristic),
  );
}

/** Learned window covering `t` seconds, if the backend returned one. */
export function windowAt(windows: LearnedWindow[], t: number): LearnedWindow | undefined {
  return windows.find((w) => t >= w.startSec && t < w.endSec);
}

function bandVerdict(probability: number, config: EnsembleConfig): SegmentVerdict {
  return verdictFor(probability, config);
}

/**
 * Fold the learned model's scores into an existing heuristic analysis.
 *
 * Returns the input unchanged (plus an explanatory note) when the model is not
 * available, so the UI keeps working offline.
 */
export function applyEnsemble(
  analysis: AnalysisResult,
  learned: LearnedModelResult,
  config: EnsembleConfig = ENSEMBLE_PARAMS,
): AnalysisResult {
  if (!learned.available) {
    return {
      ...analysis,
      notes: [
        ...analysis.notes,
        `Learned anti-spoofing model unavailable (${learned.reason ?? "not configured"}). Result below uses the on-device heuristic only.`,
      ],
    };
  }

  const segments: SegmentResult[] = analysis.segments.map((segment) => {
    if (segment.silent) return segment;
    const midpoint = (segment.startSec + segment.endSec) / 2;
    const window = windowAt(learned.windows, midpoint);
    const learnedScore = window ? window.probability : learned.globalProbability;
    const probability = blendScores(learnedScore, segment.probability, config);
    return {
      ...segment,
      probability,
      verdict: bandVerdict(probability, config),
    };
  });

  const composed = composeAnalysisResult(
    segments,
    analysis.durationSec,
    analysis.sampleRate,
    {
      uncertainLow: config.uncertainLow,
      uncertainHigh: config.uncertainHigh,
      flagSegment: config.flagSegment,
      model: learned.modelId,
    },
  );

  const notes = [...composed.notes];
  notes.push(
    `Ensemble: ${config.learnedWeight * 100}% ${learned.modelId}` +
      (learned.license ? ` (${learned.license})` : "") +
      ` + ${config.heuristicWeight * 100}% on-device heuristic.` +
      (learned.latencyMs ? ` Model latency ${learned.latencyMs} ms.` : ""),
  );

  const gap = Math.abs(learned.globalProbability - analysis.probability);
  if (gap >= 25) {
    notes.push(
      `The learned model (${learned.globalProbability.toFixed(1)}%) and the heuristic (${analysis.probability.toFixed(1)}%) disagree by ${gap.toFixed(0)} points — treat this result as lower confidence.`,
    );
  }

  if (analysis.mixedContent && learned.windows.length === 0) {
    notes.push(
      "The backend returned no per-window scores, so the partially-synthetic verdict rests on the heuristic alone.",
    );
  }

  return { ...composed, notes };
}
