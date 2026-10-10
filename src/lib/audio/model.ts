/**
 * Model registry + backend config flag (spec §1A).
 *
 * v1 bundles one backend: the signal-heuristic scorer. The registry and flag
 * exist so a trained checkpoint (LFCC/MFCC+CNN, wav2vec2, AASIST) can be dropped
 * in later without touching the analysis pipeline — see docs/MODEL_CARD.md.
 */

export type ModelBackendId = "heuristic" | "lfcc-cnn" | "wav2vec2-aasist";

export interface ModelBackend {
  id: ModelBackendId;
  /** Reported in the result's technical details. */
  modelId: string;
  label: string;
  kind: "signal" | "learned";
  /** True when this build ships runnable weights for the backend. */
  bundled: boolean;
  note: string;
}

export const MODEL_REGISTRY: Record<ModelBackendId, ModelBackend> = {
  heuristic: {
    id: "heuristic",
    modelId: "vsa-heuristic-0.1",
    label: "Signal heuristic baseline (7 cues, temperature-scaled)",
    kind: "signal",
    bundled: true,
    note: "Runs entirely on-device; no weights to download.",
  },
  "lfcc-cnn": {
    id: "lfcc-cnn",
    modelId: "vsa-lfcc-cnn-0.1",
    label: "LFCC/MFCC + CNN anti-spoofing checkpoint",
    kind: "learned",
    bundled: false,
    note: "Checkpoint not bundled in v1 — training entrypoints land with the v2 model release.",
  },
  "wav2vec2-aasist": {
    id: "wav2vec2-aasist",
    modelId: "vsa-aasist-0.1",
    label: "wav2vec2 / AASIST-style raw-audio model",
    kind: "learned",
    bundled: false,
    note: "Checkpoint not bundled in v1 — ONNX (CPU) export is planned alongside it.",
  },
};

const VALID_IDS = Object.keys(MODEL_REGISTRY) as ModelBackendId[];

function configuredId(): ModelBackendId {
  const fromEnv = import.meta.env?.VITE_VSH_MODEL as ModelBackendId | undefined;
  if (fromEnv && VALID_IDS.includes(fromEnv)) return fromEnv;
  return "heuristic";
}

export interface ResolvedModel {
  backend: ModelBackend;
  /** Present when the configured backend could not be loaded and fell back. */
  fallbackNote?: string;
}

/**
 * Resolve the configured backend. Unknown ids and unbundled checkpoints fall
 * back to the heuristic with an explicit note — the pipeline never silently
 * pretends a missing model ran.
 */
export function resolveModel(configured: ModelBackendId = configuredId()): ResolvedModel {
  const backend = MODEL_REGISTRY[configured];
  if (!backend) {
    return {
      backend: MODEL_REGISTRY.heuristic,
      fallbackNote: `Unknown model "${configured}" — using ${MODEL_REGISTRY.heuristic.modelId}.`,
    };
  }
  if (!backend.bundled) {
    return {
      backend: MODEL_REGISTRY.heuristic,
      fallbackNote: `${backend.label} is configured but not bundled in this build — scored with ${MODEL_REGISTRY.heuristic.modelId} instead. ${backend.note}`,
    };
  }
  return { backend };
}

export const MODEL_BACKEND_IDS = VALID_IDS;
