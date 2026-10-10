/**
 * Model registry + backend config flag (spec §1A).
 *
 * Two backends are live in this build:
 *  - `heuristic` (vsa-heuristic-0.1) — the signal scorer, always on-device;
 *  - `wav2vec2-aasist` — a pretrained anti-spoofing checkpoint served by the
 *    deployed backend (backend/ in this repo, Hugging Face Space or Render)
 *    and reached through a Convex action. It joins the heuristic as a
 *    weighted ensemble; see src/lib/audio/ensemble.ts and docs/eval.md.
 *
 * `lfcc-cnn` stays registered so a locally bundled checkpoint can be added
 * later without touching the pipeline.
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
  /** True when the backend runs on the deployed service, not on-device. */
  remote?: boolean;
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
    note: "Checkpoint not bundled in this build — training entrypoints land with the v2 model release.",
  },
  "wav2vec2-aasist": {
    id: "wav2vec2-aasist",
    modelId: "vsa-server-antispooof-0.1",
    label: "Pretrained wav2vec2 / AASIST-style anti-spoofing model (server)",
    kind: "learned",
    bundled: false,
    remote: true,
    note: "Served by the deployed backend (see backend/README.md) and called through a Convex action, so keys and URLs stay server-side. The first 3 minutes of audio are sent; private mode keeps everything on-device.",
  },
};

const VALID_IDS = Object.keys(MODEL_REGISTRY) as ModelBackendId[];

function configuredId(): ModelBackendId {
  const fromEnv = import.meta.env?.VITE_VSH_MODEL as ModelBackendId | undefined;
  if (fromEnv && VALID_IDS.includes(fromEnv)) return fromEnv;
  return "heuristic";
}

function remoteEnabled(): boolean {
  return import.meta.env?.VITE_VSH_REMOTE !== "off";
}

export interface ResolvedModel {
  backend: ModelBackend;
  /** Present when the configured backend could not be loaded and fell back. */
  fallbackNote?: string;
}

/**
 * Resolve the configured backend. Unknown ids and unavailable checkpoints
 * fall back to the heuristic with an explicit note — the pipeline never
 * silently pretends a missing model ran. Remote backends are resolvable
 * even though no weights are bundled; whether the service answers is checked
 * at analysis time (src/lib/audio/learned.ts).
 */
export function resolveModel(configured: ModelBackendId = configuredId()): ResolvedModel {
  const backend = MODEL_REGISTRY[configured];
  if (!backend) {
    return {
      backend: MODEL_REGISTRY.heuristic,
      fallbackNote: `Unknown model \"${configured}\" — using ${MODEL_REGISTRY.heuristic.modelId}.`,
    };
  }
  if (backend.remote && !remoteEnabled()) {
    return {
      backend: MODEL_REGISTRY.heuristic,
      fallbackNote: `${backend.label} is configured but private mode / VITE_VSH_REMOTE=off disables remote scoring — heuristic only.`,
    };
  }
  if (!backend.bundled && !backend.remote) {
    return {
      backend: MODEL_REGISTRY.heuristic,
      fallbackNote: `${backend.label} is configured but not bundled in this build — scored with ${MODEL_REGISTRY.heuristic.modelId} instead. ${backend.note}`,
    };
  }
  return { backend };
}

export const MODEL_BACKEND_IDS = VALID_IDS;
