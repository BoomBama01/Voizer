import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "risk" | "muted";

const TONE_STYLES: Record<Tone, string> = {
  ok: "border-ok/40 text-ok bg-ok-surface",
  warn: "border-warn/40 text-warn bg-warn-surface",
  risk: "border-risk/40 text-risk bg-risk-surface",
  muted: "border-border text-muted-foreground bg-muted",
};

/** `[ OK ]` / `[WARN]` status chip. */
export function StatusChip({
  tone = "ok",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase",
        TONE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A bordered window with a title bar, like a terminal emulator pane. */
export function TermWindow({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("term-window", className)}>
      <div className="term-titlebar">
        <span className="bg-risk/70 inline-block size-2 rounded-full" />
        <span className="bg-warn/70 inline-block size-2 rounded-full" />
        <span className="bg-ok/70 inline-block size-2 rounded-full" />
        <span className="ml-1 truncate font-medium">{title}</span>
        {right ? <span className="ml-auto shrink-0">{right}</span> : null}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

/** `$ voxshield --scan file.wav` style prompt line. */
export function PromptLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-sm break-words", className)}>
      <span className="text-ok mr-2 select-none">$</span>
      <span>{children}</span>
    </div>
  );
}

/** Terminal output row: `[ OK ] message`. */
export function OutputLine({
  tone = "ok",
  label,
  children,
}: {
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <StatusChip tone={tone} className="mt-0.5 shrink-0">
        {label}
      </StatusChip>
      <span className="text-muted-foreground min-w-0">{children}</span>
    </div>
  );
}

/** Small uppercase section label with a leading index, e.g. `02 / HOW IT WORKS`. */
export function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className="text-muted-foreground mono-cap flex items-center gap-3">
      <span className="text-ok font-bold">{index}</span>
      <span aria-hidden className="bg-border h-px w-8" />
      <span>{children}</span>
    </div>
  );
}

/** Monospaced key/value row used in technical tables. */
export function KeyValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="border-border/70 flex items-baseline justify-between gap-4 border-b border-dashed py-1.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd
        className={cn(
          "text-right break-all",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "risk" && "text-risk",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
