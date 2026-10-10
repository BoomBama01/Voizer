import { KeyValue, TermWindow } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AnalysisResult } from "@/lib/audio/detector";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

function ContributionBar({ value }: { value: number }) {
  // value: signed log-odds contribution, roughly within ±weight of the largest cue.
  const clamped = Math.max(-1.6, Math.min(1.6, value));
  const width = (Math.abs(clamped) / 1.6) * 50;
  const synthetic = clamped > 0;
  return (
    <div className="bg-muted relative h-2 w-full overflow-hidden rounded-sm" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className="absolute inset-y-0"
        style={{
          width: `${width}%`,
          left: synthetic ? "50%" : `${50 - width}%`,
          backgroundColor: synthetic ? "var(--status-risk)" : "var(--status-ok)",
        }}
      />
    </div>
  );
}

/** "Why was this flagged?" — the evidence behind the score, in plain language. */
export function ExplainPanel({ result }: { result: AnalysisResult }) {
  const synthetic = result.reasons.filter((r) => r.contribution > 0.02);
  const human = result.reasons.filter((r) => r.contribution <= 0.02);
  const peak = result.segments[result.peakSegmentIndex]?.features;

  return (
    <TermWindow title="why was this flagged?" right={<span className="text-muted-foreground text-[10px]">top cues first</span>}>
      <p className="text-muted-foreground text-xs leading-5">
        Each cue below is a measured property of the audio. The bar shows which way it pushed the
        verdict — red toward <span className="text-risk font-medium">synthetic</span>, green toward{" "}
        <span className="text-ok font-medium">human</span>.
      </p>

      <ul className="mt-4 space-y-4">
        {result.reasons.slice(0, 5).map((reason) => {
          const syntheticLean = reason.contribution > 0.02;
          return (
            <li key={reason.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold tracking-tight">{reason.label}</span>
                <span
                  className={cn(
                    "text-[11px] font-bold tracking-wide uppercase",
                    syntheticLean ? "text-risk" : "text-ok",
                  )}
                >
                  {syntheticLean ? "synthetic" : "human"} {(Math.abs(reason.contribution) * 100).toFixed(0)}
                </span>
              </div>
              <div className="mt-1.5">
                <ContributionBar value={reason.contribution} />
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-5">{reason.detail}</p>
            </li>
          );
        })}
      </ul>

      {synthetic.length === 0 && human.length > 0 ? (
        <p className="text-ok mt-4 border-ok/30 border-t border-dashed pt-3 text-xs">
          No synthetic cue exceeded its threshold in this recording.
        </p>
      ) : null}

      <Collapsible className="mt-5">
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="group w-full cursor-pointer justify-between gap-2 uppercase"
          >
            technical details
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-border bg-background mt-3 rounded-md border p-4">
            <p className="text-muted-foreground mb-2 text-[11px] tracking-[0.14em] uppercase">
              most suspicious window #{result.peakSegmentIndex + 1}
            </p>
            {peak ? (
              <dl>
                <KeyValue label="noise floor (p10)" value={`${peak.noiseFloorDb.toFixed(1)} dBFS`} />
                <KeyValue label="speech headroom (p90)" value={`${peak.peakDb.toFixed(1)} dBFS`} />
                <KeyValue label="SNR" value={`${peak.snrDb.toFixed(1)} dB`} tone={peak.snrDb > 55 ? "risk" : undefined} />
                <KeyValue label="digital-zero ratio" value={`${(peak.zeroRatio * 100).toFixed(1)}%`} tone={peak.zeroRatio > 0.4 ? "risk" : undefined} />
                <KeyValue label="99.5% energy edge" value={`${peak.f995Hz.toFixed(0)} Hz`} tone={peak.f995Hz < 7000 ? "risk" : undefined} />
                <KeyValue
                  label="spectral cliff"
                  value={peak.edgeHz > 0 ? `${peak.edgeDropDb.toFixed(1)} dB @ ${peak.edgeHz.toFixed(0)} Hz` : "none"}
                  tone={peak.edgeDropDb > 15 ? "risk" : undefined}
                />
                <KeyValue label="energy > 6 kHz" value={`${(peak.hfRatio * 100).toFixed(2)}%`} tone={peak.hfRatio < 0.06 ? "risk" : undefined} />
                <KeyValue label="5–8 kHz flatness" value={peak.flatnessHigh.toFixed(3)} />
                <KeyValue
                  label="pitch"
                  value={
                    peak.pitchMedianHz > 0
                      ? `${peak.pitchMedianHz.toFixed(0)} Hz ± ${peak.pitchStdSemis.toFixed(1)} semitones`
                      : "unvoiced"
                  }
                  tone={peak.pitchMedianHz > 0 && peak.pitchStdSemis < 1.5 ? "risk" : undefined}
                />
                <KeyValue label="voiced frames" value={`${(peak.voicedFraction * 100).toFixed(0)}%`} />
                <KeyValue label="spectral flux" value={`${peak.flux.toFixed(2)} dB/frame`} />
                <KeyValue label="channel" value={peak.narrowband ? "narrowband ≈3.4 kHz" : "wideband"} tone={peak.narrowband ? "warn" : "ok"} />
                <KeyValue label="frames scored" value={String(peak.frameCount)} />
              </dl>
            ) : null}
            <p className="text-muted-foreground mt-3 border-border border-t border-dashed pt-3 text-[11px] leading-5">
              Probabilities are temperature-scaled (T = 1.15) and an uncertainty band is enforced
              between 40% and 60%. This build uses a signal-heuristic baseline; the trained
              wav2vec2 / AASIST checkpoint slots in behind the same interface.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TermWindow>
  );
}
