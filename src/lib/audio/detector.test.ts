import { describe, expect, it } from "vitest";
import { fft } from "./fft";
import { extractSegmentFeatures } from "./features";
import { DETECTOR_PARAMS, analyzeSignal, confidenceFor, verdictFor } from "./detector";
import { synthesizeClip } from "./synth";

const SR = 16000;

describe("fft", () => {
  it("locates a pure tone in the expected bin", () => {
    const n = 1024;
    const bin = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fft(re, im);
    let peak = 0;
    let peakIdx = 0;
    for (let k = 0; k < n / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag > peak) {
        peak = mag;
        peakIdx = k;
      }
    }
    expect(peakIdx).toBe(bin);
    expect(peak).toBeGreaterThan(400);
  });

  it("rejects non power-of-two sizes", () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow();
  });
});

describe("features", () => {
  it("reports digital silence for a silent window", () => {
    const features = extractSegmentFeatures(new Float32Array(SR * 4), SR);
    expect(features.peakDb).toBeLessThan(-90);
    expect(features.snrDb).toBeLessThan(1);
  });

  it("separates natural from synthetic demo clips", () => {
    const natural = extractSegmentFeatures(
      synthesizeClip("real", { seconds: 6 }).subarray(0, 4 * SR),
      SR,
    );
    const synthetic = extractSegmentFeatures(
      synthesizeClip("clone", { seconds: 6 }).subarray(0, 4 * SR),
      SR,
    );

    expect(natural.snrDb).toBeLessThan(55);
    expect(synthetic.snrDb).toBeGreaterThan(65);
    expect(natural.zeroRatio).toBeLessThan(0.2);
    expect(synthetic.zeroRatio).toBeGreaterThan(0.7);
    expect(natural.hfRatio).toBeGreaterThan(synthetic.hfRatio);
    expect(natural.flatnessHigh).toBeGreaterThan(synthetic.flatnessHigh);
    expect(natural.f995Hz).toBeGreaterThan(synthetic.f995Hz);
  });
});

describe("verdict bands", () => {
  it("keeps the 40–60 band uncertain", () => {
    expect(verdictFor(39.9)).toBe("real");
    expect(verdictFor(40)).toBe("uncertain");
    expect(verdictFor(59.9)).toBe("uncertain");
    expect(verdictFor(60)).toBe("ai");
    expect(DETECTOR_PARAMS.uncertainLow).toBe(40);
    expect(DETECTOR_PARAMS.uncertainHigh).toBe(60);
  });

  it("derives confidence from distance to the decision boundary", () => {
    expect(confidenceFor(50).level).toBe("low");
    expect(confidenceFor(70).level).toBe("medium");
    expect(confidenceFor(95).level).toBe("high");
    expect(confidenceFor(50).value).toBe(0);
  });
});

describe("analyzeSignal", () => {
  it("scores a natural recording as human with high confidence", () => {
    const clip = synthesizeClip("real", { seconds: 12 });
    const result = analyzeSignal(clip, SR);
    expect(result.verdict).toBe("real");
    expect(result.probability).toBeLessThan(25);
    expect(result.confidenceLevel).toBe("high");
    expect(result.segments).toHaveLength(5);
    expect(result.flaggedSegments).toHaveLength(0);
    expect(result.mixedContent).toBe(false);
  });

  it("scores a cloned recording as AI-generated", () => {
    const clip = synthesizeClip("clone", { seconds: 12 });
    const result = analyzeSignal(clip, SR);
    expect(result.verdict).toBe("ai");
    expect(result.probability).toBeGreaterThan(65);
    expect(result.confidenceLevel).toBe("high");
    expect(result.flaggedSegments.length).toBeGreaterThanOrEqual(3);
  });

  it("catches a partially cloned recording window by window", () => {
    const clip = synthesizeClip("mixed", { seconds: 12 });
    const result = analyzeSignal(clip, SR);
    expect(result.verdict).toBe("partial");
    expect(result.mixedContent).toBe(true);
    expect(result.flaggedSegments.length).toBeGreaterThanOrEqual(1);

    const first = result.segments[0];
    const last = result.segments[result.segments.length - 1];
    expect(first.probability).toBeLessThan(25);
    expect(last.probability).toBeGreaterThan(65);
    expect(last.startSec).toBeGreaterThan(0);
  });

  it("returns explainable, ordered reasons", () => {
    const result = analyzeSignal(synthesizeClip("clone", { seconds: 8 }), SR);
    expect(result.reasons.length).toBeGreaterThan(3);
    const magnitudes = result.reasons.map((r) => Math.abs(r.contribution));
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
    expect(result.reasons[0].detail.length).toBeGreaterThan(20);
  });

  it("marks all-silent input without crashing", () => {
    const result = analyzeSignal(new Float32Array(SR * 6), SR);
    expect(result.segments.every((s) => s.silent)).toBe(true);
    expect(Number.isNaN(result.probability)).toBe(false);
    expect(result.notes.join(" ")).toContain("silent");
  });

  it("handles clips shorter than the analysis window", () => {
    const clip = synthesizeClip("real", { seconds: 2 });
    const result = analyzeSignal(clip, SR);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].endSec).toBeCloseTo(2, 1);
    expect(result.notes.join(" ")).toContain("shorter than");
  });

  it("analyzes asynchronously with monotonic progress", async () => {
    const { analyzeSignalAsync } = await import("./detector");
    const clip = synthesizeClip("clone", { seconds: 6 });
    const seen: number[] = [];
    const result = await analyzeSignalAsync(clip, SR, (f) => seen.push(f));
    expect(result.segments.length).toBeGreaterThan(1);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
