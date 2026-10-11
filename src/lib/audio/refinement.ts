export interface WindowLike {
  startSec: number;
  endSec: number;
  p: number;
  heuristicP: number;
  verdict: string;
  cues: string[];
  explanation: string;
}

export interface Cluster {
  loSec: number;
  hiSec: number;
  score: number;
  cues: string[];
  explanation: string;
}

export interface ApplicationRefinement {
  clusters: Cluster[];
}

/**
 * Build application-level investigative clusters from per-window scores + hints.
 * Returns null when there is nothing to cluster.
 */
export function buildApplicationRefinement(
  windows: WindowLike[],
  hints: WindowLike[],
  drifts: WindowLike[],
): ApplicationRefinement | null {
  if (windows.length === 0 && hints.length === 0 && drifts.length === 0) {
    return null;
  }

  function spanKey(startSec: number, endSec: number): string {
    return `${startSec.toFixed(4)}-${endSec.toFixed(4)}`;
  }

  const extraSpans = new Map<string, WindowLike>();
  for (const item of [...hints, ...drifts]) {
    const key = spanKey(item.startSec, item.endSec);
    if (item.p > 0 || (item.verdict === "flag" && item.explanation)) {
      extraSpans.set(key, item);
    }
  }

  const clusters: Cluster[] = [];
  let cursor = 0;

  while (cursor < windows.length) {
    const window = windows[cursor];
    const effectiveP = Math.max(window.p, window.heuristicP || 0);
    if (effectiveP < 65) {
      cursor++;
      continue;
    }

    let loSec = window.startSec;
    let hiSec = window.endSec;
    let scoreSum = window.p;
    let cueCount = window.cues.length;
    let explanationParts: string[] = [];
    if (window.explanation) explanationParts.push(window.explanation);

    // Absorb adjacent windows while the band stays consecutive.
    let next = cursor + 1;
    while (next < windows.length && windows[next].startSec <= hiSec + 0.001) {
      const w = windows[next];
      const wEff = Math.max(w.p, w.heuristicP ?? w.p);
      if (wEff < 65) break;
      hiSec = w.endSec;
      scoreSum += w.p;
      cueCount += w.cues.length;
      if (w.explanation) explanationParts.push(w.explanation);
      next++;
    }
    const memberCount = (next - cursor) + 1;
    const averageScore = memberCount > 0 ? scoreSum / memberCount : 0;

    // Fold in any hint/drift spans that overlap this span.
    const spanStart = loSec;
    const spanEnd = hiSec;
    for (const [key, extra] of extraSpans) {
      if (extra.startSec >= spanEnd || extra.endSec <= spanStart) continue;
      hiSec = Math.max(hiSec, extra.endSec);
      loSec = Math.min(loSec, extra.startSec);
      if (extra.p > 0) scoreSum += extra.p;
      cueCount += extra.cues.length;
      if (extra.verdict === "flag" && extra.explanation) {
        explanationParts.push(extra.explanation);
      }
    }

    const finalMemberCount = (next - cursor) + 1;
    const finalAverageScore = finalMemberCount > 0 ? scoreSum / finalMemberCount : 0;
    clusters.push({
      loSec,
      hiSec,
      score: Math.min(100, Math.max(0, finalAverageScore)),
      cues: explanationParts.filter(Boolean).slice(0, 3),
      explanation: explanationParts.filter(Boolean).join("; "),
    });

    cursor = next;
  }

  if (clusters.length === 0) return null;
  return { clusters };
}
