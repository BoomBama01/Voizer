import { describe, expect, it } from "vitest";
import {
  MODEL_BACKEND_IDS,
  MODEL_REGISTRY,
  resolveModel,
  type ModelBackendId,
} from "./model";
import { analyzeSignal } from "./detector";
import { synthesizeClip } from "./synth";

describe("model registry", () => {
  it("ships exactly one bundled backend in v1", () => {
    const bundled = MODEL_BACKEND_IDS.filter((id) => MODEL_REGISTRY[id].bundled);
    expect(bundled).toEqual(["heuristic"]);
    expect(MODEL_REGISTRY.heuristic.modelId).toBe("vsa-heuristic-0.1");
    expect(MODEL_REGISTRY.heuristic.kind).toBe("signal");
  });

  it("documents the learned backends that can be swapped in", () => {
    expect(MODEL_REGISTRY["lfcc-cnn"].kind).toBe("learned");
    expect(MODEL_REGISTRY["wav2vec2-aasist"].kind).toBe("learned");
    expect(MODEL_REGISTRY["lfcc-cnn"].note.length).toBeGreaterThan(20);
  });
});

describe("resolveModel", () => {
  it("resolves the default backend without a fallback note", () => {
    const resolved = resolveModel();
    expect(resolved.backend.id).toBe("heuristic");
    expect(resolved.fallbackNote).toBeUndefined();
  });

  it("falls back with an explicit note when a checkpoint is not bundled", () => {
    const resolved = resolveModel("wav2vec2-aasist");
    expect(resolved.backend.id).toBe("heuristic");
    expect(resolved.fallbackNote).toContain("not bundled");
    expect(resolved.fallbackNote).toContain("wav2vec2");
  });

  it("falls back on unknown ids instead of crashing", () => {
    const resolved = resolveModel("gpt5" as ModelBackendId);
    expect(resolved.backend.id).toBe("heuristic");
    expect(resolved.fallbackNote).toContain("Unknown model");
  });
});

describe("analysis result model metadata", () => {
  it("reports the resolved model id in the result", () => {
    const result = analyzeSignal(synthesizeClip("real", { seconds: 6 }), 16000);
    expect(result.model).toBe(MODEL_REGISTRY.heuristic.modelId);
  });
});
