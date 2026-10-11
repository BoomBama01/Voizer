import { buildApplicationRefinement, type WindowLike, type Cluster } from "./refinement";

function stubWindow(dep: Partial<WindowLike>): WindowLike {
  return {
    startSec: dep.startSec ?? 0,
    endSec: dep.endSec ?? 4,
    p: dep.p ?? 50,
    heuristicP: dep.heuristicP ?? (dep.p ?? 50),
    verdict: dep.verdict ?? "flag",
    cues: dep.cues ?? [],
    explanation: dep.explanation ?? "",
  };
}

describe("buildApplicationRefinement", () => {
  it("returns null metadata when there is nothing to cluster", () => {
    const result = buildApplicationRefinement([], [], []);
    expect(result).toBeNull();
  });

  it("clusters consecutive scores into weighted investigations", () => {
    const windows: WindowLike[] = [
      stubWindow({ startSec: 0, endSec: 4, p: 100 }),
      stubWindow({ startSec: 4, endSec: 8, p: 100 }),
      stubWindow({ startSec: 8, endSec: 12, p: 55 }),
      stubWindow({ startSec: 12, endSec: 16, p: 55 }),
    ];
    const hints: WindowLike[] = [];
    const drifts: WindowLike[] = [];
    const r = buildApplicationRefinement(windows, hints, drifts);
    expect(r !== null).toBe(true);
    expect((r as NonNullable<typeof r>).clusters.length).toBeGreaterThan(0);

    const cluster = r as NonNullable<typeof r>;
    expect(cluster.clusters.length).toBe(1);
    const c = cluster.clusters[0];
    expect(c.loSec).toBeCloseTo(0, 3);
    expect(c.hiSec).toBeCloseTo(8, 3);
    expect(c.score).toBe(100);
  });

  it("includes adjacent hint metadata inside span clusters", () => {
    const windows: WindowLike[] = [
      stubWindow({ startSec: 0, endSec: 4, p: 60, heuristicP: 80 }),
      stubWindow({ startSec: 4, endSec: 8, p: 62, heuristicP: 80 }),
    ];
    const hints: WindowLike[] = [
      stubWindow({ startSec: 2, endSec: 3, p: 78, verdict: "flag" }),
    ];
    const drifts: WindowLike[] = [];
    const r = buildApplicationRefinement(windows, hints, drifts);
    expect(r !== null).toBe(true);
    const cluster = r as NonNullable<typeof r>;
    expect(
      cluster.clusters.some((c: Cluster) => c.loSec <= 2 && c.hiSec >= 3),
    ).toBe(true);
  });
});
