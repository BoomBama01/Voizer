import type { Verdict } from "@/lib/audio/detector";

export type RiskLevel = "safe" | "suspicious" | "high";

export interface RiskMeter {
  /** 0–100 displayed on the meter. */
  score: number;
  level: RiskLevel;
  label: string;
  /** Contribution of the voice-clone detector (0–100). */
  voiceRisk: number;
  /** Contribution of the scam-script detector (0–100). */
  scriptRisk: number;
  /** Which signal drove the verdict, in plain language. */
  reason: string;
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  safe: "SAFE",
  suspicious: "SUSPICIOUS",
  high: "HIGH RISK",
};

/**
 * Combine the two detectors.
 *
 * The score is driven by the *stronger* signal (either a synthetic voice or a
 * scripted scam is enough cause for concern) with a small bump when both are
 * elevated. A partially cloned recording is treated as at least suspicious.
 */
export function combineRisk(
  voiceProbability: number,
  verdict: Verdict,
  scriptScore: number,
): RiskMeter {
  const voiceRisk = Math.max(
    verdict === "partial" ? 70 : 0,
    Math.max(0, Math.min(100, voiceProbability)),
  );
  const scriptRisk = Math.max(0, Math.min(100, scriptScore));
  const score = Math.round(
    Math.max(voiceRisk, scriptRisk) + 0.15 * Math.min(voiceRisk, scriptRisk),
  );

  const level: RiskLevel = score < 35 ? "safe" : score < 65 ? "suspicious" : "high";

  let reason: string;
  if (voiceRisk >= 65 && scriptRisk >= 45) {
    reason = "Both the voice and the words match known voice-cloning scam patterns.";
  } else if (voiceRisk >= 65) {
    reason =
      "The recording carries strong synthesis artifacts even though the script does not read as a scam.";
  } else if (scriptRisk >= 65) {
    reason =
      "The transcript follows a known scam script; the voice itself looks natural, which is how most scam calls arrive.";
  } else if (scriptRisk >= 40) {
    reason = "The transcript contains pressure tactics worth verifying before you act.";
  } else if (voiceRisk >= 40) {
    reason = "The audio analysis is inconclusive — treat this as unverified.";
  } else {
    reason = "No synthesis artifacts and no scam-script indicators were found.";
  }

  return { score, level, label: RISK_LABELS[level], voiceRisk, scriptRisk, reason };
}
