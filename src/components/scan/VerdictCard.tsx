import { KeyValue, StatusChip, TermWindow, type Tone } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/audio/detector";
import { formatBytes, formatDuration } from "@/lib/audio/validate";
import type { RiskMeter } from "@/lib/scam/risk";
import { CONFIDENCE_META, RISK_META, TONE_HEX, VERDICT_META } from "@/lib/ui-meta";
import { cn } from "@/lib/utils";
import { Clock, Cpu, FileAudio, Trash2, Upload } from "lucide-react";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ConfidenceRing({
  value,
  tone,
  level,
}: {
  value: number;
  tone: Tone;
  level: string;
}) {
  const offset = CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <div className="relative inline-flex items-center justify-center" role="img" aria-label={`Confidence ${Math.round(value)} percent, ${level}`}>
      <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
        {/* mirror of --border: SVG attributes cannot reliably use var() */}
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#d8d5c7" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="8"
          strokeLinecap="butt"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
        <text
          x="60"
          y="56"
          textAnchor="middle"
          className="fill-foreground text-2xl font-bold"
          style={{ fontFamily: "inherit" }}
        >
          {Math.round(value)}%
        </text>
        <text
          x="60"
          y="74"
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] tracking-[0.16em] uppercase"
          style={{ fontFamily: "inherit" }}
        >
          confidence
        </text>
      </svg>
    </div>
  );
}

function RiskBar({ risk }: { risk: RiskMeter }) {
  const meta = RISK_META[risk.level];
  const position = Math.min(99.5, Math.max(0.5, risk.score));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground mono-cap">combined risk meter</span>
        <span className="text-sm font-bold tracking-tight" style={{ color: meta.hex }}>
          {meta.label} · {risk.score}
        </span>
      </div>

      <div
        className="border-border relative h-6 overflow-hidden rounded-sm border"
        role="meter"
        aria-valuenow={risk.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Combined risk ${risk.score} out of 100`}
      >
        <div className="absolute inset-0 flex">
          <div className="bg-ok-surface h-full" style={{ width: "35%" }} />
          <div className="bg-warn-surface h-full" style={{ width: "30%" }} />
          <div className="bg-risk-surface h-full" style={{ width: "35%" }} />
        </div>
        <div className="border-border absolute inset-y-0 w-px border-l" style={{ left: "35%" }} />
        <div className="border-border absolute inset-y-0 w-px border-l" style={{ left: "65%" }} />
        <div
          className="absolute inset-y-0 w-0.5"
          style={{ left: `${position}%`, backgroundColor: meta.hex }}
        >
          <span
            className="absolute -top-0.5 -left-[3px] size-2 rotate-45"
            style={{ backgroundColor: meta.hex }}
          />
        </div>
      </div>

      <div className="text-muted-foreground mt-1.5 flex justify-between text-[10px] tracking-[0.12em] uppercase">
        <span>safe</span>
        <span>suspicious</span>
        <span>high risk</span>
      </div>
      <p className="text-muted-foreground mt-2 text-xs leading-5">{risk.reason}</p>
    </div>
  );
}

export function VerdictCard({
  result,
  risk,
  fileName,
  fileSize,
  format,
  hash,
  onReset,
}: {
  result: AnalysisResult;
  risk: RiskMeter;
  fileName: string;
  fileSize: number;
  format: string;
  hash?: string;
  onReset: () => void;
}) {
  const meta = VERDICT_META[result.verdict];
  const confidence = CONFIDENCE_META[result.confidenceLevel];
  const flagged = result.flaggedSegments.length;

  return (
    <TermWindow
      title="result"
      right={<StatusChip tone={meta.tone}>{meta.label}</StatusChip>}
      bodyClassName="p-0"
    >
      <div className="grid gap-px bg-border lg:grid-cols-[1.4fr_1fr]">
        {/* verdict + risk */}
        <div className="bg-card flex flex-col gap-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <span className="text-muted-foreground mono-cap">verdict</span>
              <p
                className={cn(
                  "mt-2 text-2xl leading-tight font-bold tracking-tight sm:text-3xl",
                  meta.tone === "ok" && "text-ok",
                  meta.tone === "warn" && "text-warn",
                  meta.tone === "risk" && "text-risk",
                )}
              >
                {meta.label}
              </p>
              <p className="text-muted-foreground mt-2 max-w-md text-xs leading-5">{meta.blurb}</p>

              <div className="mt-5 flex flex-wrap items-end gap-6">
                <div>
                  <span className="text-muted-foreground mono-cap">AI probability</span>
                  <p className="text-4xl leading-none font-bold tracking-tight">
                    {result.probability.toFixed(1)}
                    <span className="text-muted-foreground text-lg">%</span>
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground mono-cap">windows flagged</span>
                  <p className="text-4xl leading-none font-bold tracking-tight">
                    {flagged}
                    <span className="text-muted-foreground text-lg">/{result.segments.length}</span>
                  </p>
                </div>
              </div>
            </div>

            <ConfidenceRing
              value={result.confidence}
              tone={meta.tone}
              level={confidence.label}
            />
          </div>

          <div className="border-border border-t border-dashed pt-5">
            <RiskBar risk={risk} />
          </div>

          {result.notes.length > 0 ? (
            <ul className="space-y-1.5">
              {result.notes.map((note) => (
                <li
                  key={note}
                  className="text-muted-foreground flex items-start gap-2 text-xs leading-5"
                >
                  <span className="text-warn mt-0.5 font-bold" aria-hidden>
                    !
                  </span>
                  {note}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onReset} className="cursor-pointer gap-2 uppercase">
              <Upload className="size-3.5" aria-hidden />
              new scan
            </Button>
          </div>
        </div>

        {/* metadata */}
        <div className="bg-card p-5 sm:p-6">
          <span className="text-muted-foreground mono-cap">technical details</span>
          <dl className="mt-3">
            <KeyValue label="file" value={<span className="break-all">{fileName}</span>} />
            <KeyValue label="container" value={format} />
            <KeyValue label="size" value={formatBytes(fileSize)} />
            <KeyValue label="duration" value={formatDuration(result.durationSec)} />
            <KeyValue label="analysis rate" value={`${result.sampleRate} Hz mono`} />
            <KeyValue label="windows" value={`${result.segments.length} × 4.0 s (2.0 s hop)`} />
            <KeyValue
              label="model"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="size-3.5" aria-hidden />
                  {result.model}
                </span>
              }
            />
            <KeyValue
              label="peak window"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5" aria-hidden />
                  #{result.peakSegmentIndex + 1} ·{" "}
                  {result.segments[result.peakSegmentIndex]?.probability.toFixed(1)}%
                </span>
              }
              tone={result.flaggedSegments.length > 0 ? "risk" : undefined}
            />
            <KeyValue
              label="sha-256"
              value={
                hash ? (
                  <span className="font-mono text-[11px]">{hash.slice(0, 16)}…</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <FileAudio className="size-3.5" aria-hidden />
                    n/a
                  </span>
                )
              }
            />
            <KeyValue label="analysed at" value={new Date(result.analyzedAt).toLocaleString()} />
          </dl>

          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-risk mt-4 w-full cursor-pointer gap-2 uppercase"
          >
            <Trash2 className="size-3.5" aria-hidden />
            delete analysis now
          </Button>
        </div>
      </div>
    </TermWindow>
  );
}
