import { StatusChip } from "@/components/Terminal";
import type { AnalysisResult } from "@/lib/audio/detector";
import type { LearnedModelResult } from "@/lib/audio/ensemble";
import type { MusicReport } from "@/lib/audio/music";

export interface VocalsResult {
  probability: number;
  verdict: AnalysisResult["verdict"];
  available: boolean;
  note?: string;
}

export interface EnsemblePanelProps {
  result: AnalysisResult;
  /** Score from the on-device heuristic alone. */
  heuristicProbability: number;
  learned?: LearnedModelResult | null;
  music?: MusicReport | null;
  vocals?: VocalsResult | null;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function EnsemblePanel({
  result,
  heuristicProbability,
  learned,
  music,
  vocals,
}: EnsemblePanelProps) {
  const learnedRow = learned?.available ? (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground">
        [ OK ] learned model <span className="text-muted-foreground">{learned.modelId}</span>
        {learned.license ? (
          <span className="text-muted-foreground"> ({learned.license})</span>
        ) : null}
      </span>
      <span className="text-foreground tabular-nums">
        {pct(learned.globalProbability)}
        {learned.latencyMs ? (
          <span className="text-muted-foreground"> · {learned.latencyMs} ms</span>
        ) : null}
      </span>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">
        [ -- ] learned model <span className="opacity-80">unavailable</span>
      </span>
      <span className="text-muted-foreground">heuristic only</span>
    </div>
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">model scores</h3>
        <StatusChip tone={learned?.available ? "ok" : "muted"}>
          {learned?.available ? "ensemble" : "on-device only"}
        </StatusChip>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-foreground">
            [ OK ] heuristic <span className="text-muted-foreground">vsa-heuristic-0.1</span>
          </span>
          <span className="text-foreground tabular-nums">{pct(heuristicProbability)}</span>
        </div>
        {learnedRow}
        <div className="border-border mt-1 flex items-center justify-between gap-3 border-t pt-1.5">
          <span className="text-foreground font-semibold">ensemble (75% learned · 25% heuristic)</span>
          <span className="text-foreground font-semibold tabular-nums">
            {pct(result.probability)}
          </span>
        </div>
      </div>

      <div className="border-border border-t pt-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-foreground">music mode</span>
          {music ? (
            <StatusChip tone={music.isMusic ? "warn" : "muted"}>
              {music.isMusic ? `song/mix ${(music.confidence * 100).toFixed(0)}%` : "speech"}
            </StatusChip>
          ) : (
            <StatusChip tone="muted">not checked</StatusChip>
          )}
        </div>
        {music ? <p className="text-muted-foreground mt-1 leading-5">{music.reason}</p> : null}
        {music?.isMusic && vocals ? (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground">vocals (demucs stem)</span>
              <span className="text-foreground tabular-nums">
                {vocals.available ? `${pct(vocals.probability)} · ${vocals.verdict}` : "unavailable"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground">full mix</span>
              <span className="text-foreground tabular-nums">{pct(result.probability)}</span>
            </div>
            {vocals.note ? (
              <p className="text-muted-foreground leading-5">{vocals.note}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
