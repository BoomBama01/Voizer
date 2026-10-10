import { StatusChip, TermWindow, type Tone } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORY_LABELS,
  analyzeTranscript,
  type FlaggedPhrase,
  type ScamAnalysis,
} from "@/lib/scam/rules";
import { cn } from "@/lib/utils";
import { Languages, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

const LEVEL_TONE: Record<ScamAnalysis["level"], Tone> = {
  none: "ok",
  low: "warn",
  medium: "warn",
  high: "risk",
};

const LEVEL_LABEL: Record<ScamAnalysis["level"], string> = {
  none: "no indicators",
  low: "few indicators",
  medium: "several indicators",
  high: "scam script",
};

const LANGUAGE_LABEL = {
  en: "english",
  hi: "हिन्दी",
  kn: "ಕನ್ನಡ",
  unknown: "unknown",
} as const;

export function ScamPanel({
  initialTranscript,
  languageHint,
  note,
  analysis,
  onAnalysisChange,
}: {
  initialTranscript: string;
  languageHint?: "en" | "hi";
  note?: string;
  analysis: ScamAnalysis;
  onAnalysisChange: (analysis: ScamAnalysis) => void;
}) {
  const [draft, setDraft] = useState(initialTranscript);
  // Text that has actually been analysed — highlights are anchored to these
  // offsets, so they stay correct while the textarea keeps being edited.
  const [analysedText, setAnalysedText] = useState(initialTranscript);
  // The panel is keyed per analysis, so a new clip remounts it with the fresh
  // transcript; no synchronising effect is needed.

  const marks = useMemo(() => {
    const out: Array<{ start: number; end: number; label: string; explain: string }> = [];
    for (const flag of analysis.flags) {
      const last = out[out.length - 1];
      if (last && flag.start <= last.end) {
        last.end = Math.max(last.end, flag.end);
        continue;
      }
      out.push({ start: flag.start, end: flag.end, label: flag.label, explain: flag.explain });
    }
    return out;
  }, [analysis.flags]);

  const highlighted = useMemo(() => {
    if (marks.length === 0) return [{ text: analysedText, mark: false, markIndex: -1 }];
    const parts: Array<{ text: string; mark: boolean; markIndex: number }> = [];
    let cursor = 0;
    let markIndex = 0;
    for (const mark of marks) {
      if (mark.start > cursor) {
        parts.push({ text: analysedText.slice(cursor, mark.start), mark: false, markIndex: -1 });
      }
      parts.push({ text: analysedText.slice(mark.start, mark.end), mark: true, markIndex });
      cursor = mark.end;
      markIndex++;
    }
    if (cursor < analysedText.length) {
      parts.push({ text: analysedText.slice(cursor), mark: false, markIndex: -1 });
    }
    return parts.filter((part) => part.text.length > 0);
  }, [analysedText, marks]);

  const uniqueFlags = useMemo(() => {
    const seen = new Map<string, FlaggedPhrase>();
    for (const flag of analysis.flags) {
      if (!seen.has(flag.ruleId)) seen.set(flag.ruleId, flag);
    }
    return Array.from(seen.values()).sort((a, b) => b.weight - a.weight);
  }, [analysis.flags]);

  const run = (text: string) => {
    setAnalysedText(text);
    onAnalysisChange(analyzeTranscript(text));
  };

  return (
    <TermWindow
      title="scam-script check"
      right={<StatusChip tone={LEVEL_TONE[analysis.level]}>{LEVEL_LABEL[analysis.level]}</StatusChip>}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Languages className="size-3.5" aria-hidden />
          detected:
        </span>
        <StatusChip tone="muted">{LANGUAGE_LABEL[analysis.language]}</StatusChip>
        {languageHint && languageHint !== analysis.language ? (
          <span className="text-muted-foreground">clip supplied a {LANGUAGE_LABEL[languageHint]} transcript</span>
        ) : null}
        <span className="text-muted-foreground ml-auto">
          rules matched: <span className="text-foreground font-bold">{analysis.matchedRules.length}</span>
        </span>
      </div>

      <label className="mt-4 block">
        <span className="text-muted-foreground mono-cap">transcript</span>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Paste what was said — English, हिन्दी or ಕನ್ನಡ. Auto-transcription ships with v2; the rule engine runs on whatever you paste."
          className="mt-1.5 min-h-28 text-sm leading-6"
          aria-label="Transcript of the call"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => run(draft)} className="cursor-pointer gap-1.5 uppercase">
          <RotateCcw className="size-3.5" aria-hidden />
          analyse transcript
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft("");
            setAnalysedText("");
            onAnalysisChange(analyzeTranscript(""));
          }}
          className="text-muted-foreground cursor-pointer uppercase"
        >
          clear
        </Button>
        {note ? <span className="text-muted-foreground text-[11px]">{note}</span> : null}
      </div>

      {analysis.flags.length > 0 ? (
        <>
          <div className="border-border mt-4 border-t border-dashed pt-4">
            <span className="text-muted-foreground mono-cap">flagged phrases</span>
            <p className="bg-background border-border mt-2 max-h-44 overflow-y-auto rounded-md border p-3 text-sm leading-7">
              {highlighted.map((part, i) =>
                part.mark ? (
                  <mark
                    key={i}
                    title={`${marks[part.markIndex]?.label} — ${marks[part.markIndex]?.explain}`}
                    className="bg-risk-surface text-risk rounded-[2px] px-0.5 font-medium decoration-risk/60"
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
          </div>

          <ul className="mt-4 space-y-3">
            {uniqueFlags.map((flag) => (
              <li key={flag.ruleId} className="flex items-start gap-3">
                <StatusChip tone="risk" className="mt-0.5 shrink-0">
                  {CATEGORY_LABELS[flag.category]}
                </StatusChip>
                <div className="min-w-0">
                  <p className="text-sm font-bold tracking-tight">{flag.label}</p>
                  <p className="text-muted-foreground text-xs leading-5">{flag.explain}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="border-border bg-muted/40 mt-4 rounded-md border border-dashed p-4 text-center">
          <p className={cn("text-sm font-bold tracking-tight", analysis.score === 0 && "text-ok")}>
            {draft.trim() ? "No scam indicators found in this transcript." : "No transcript yet."}
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {draft.trim()
              ? "That does not clear the call on its own — the voice score still applies."
              : "Paste what was said to check for urgency, OTP requests, impersonation, threats, transfers and remote-access apps."}
          </p>
        </div>
      )}

      {analysis.summary.length > 0 ? (
        <div className="mt-4">
          <span className="text-muted-foreground mono-cap">what to do</span>
          <ul className="mt-2 space-y-1.5">
            {analysis.summary.map((tip) => (
              <li key={tip} className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                <span className="text-warn mt-0.5 font-bold" aria-hidden>
                  ▸
                </span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </TermWindow>
  );
}
