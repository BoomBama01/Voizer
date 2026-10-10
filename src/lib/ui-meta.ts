export type Tone = "ok" | "warn" | "risk" | "muted";

import type { ConfidenceLevel, Verdict } from "@/lib/audio/detector";
import type { RiskLevel } from "@/lib/scam/risk";

export const TONE_HEX: Record<Tone, string> = {
  ok: "#1f7a3d",
  warn: "#96600a",
  risk: "#a92d2d",
  muted: "#5c635a",
};

export const VERDICT_META: Record<
  Verdict,
  { label: string; blurb: string; tone: Tone }
> = {
  real: {
    label: "LIKELY HUMAN",
    blurb: "No reliable synthesis artifacts found in this recording.",
    tone: "ok",
  },
  uncertain: {
    label: "UNCERTAIN",
    blurb: "Evidence sits inside the 40–60% band — the detector is refusing to guess.",
    tone: "warn",
  },
  partial: {
    label: "PARTIALLY SYNTHETIC",
    blurb: "Some 4-second windows look cloned while others look natural.",
    tone: "warn",
  },
  ai: {
    label: "LIKELY AI-GENERATED",
    blurb: "Synthesis or cloning artifacts are present across most of the recording.",
    tone: "risk",
  },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: Tone; hex: string }> = {
  safe: { label: "SAFE", tone: "ok", hex: TONE_HEX.ok },
  suspicious: { label: "SUSPICIOUS", tone: "warn", hex: TONE_HEX.warn },
  high: { label: "HIGH RISK", tone: "risk", hex: TONE_HEX.risk },
};

export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; tone: Tone }> = {
  low: { label: "low", tone: "warn" },
  medium: { label: "medium", tone: "muted" },
  high: { label: "high", tone: "ok" },
};

export const VERDICT_TONE_CLASS: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  risk: "text-risk",
  muted: "text-muted-foreground",
};
