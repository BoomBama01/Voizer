import { StatusChip, TermWindow, type Tone } from "@/components/Terminal";
import { Progress } from "@/components/ui/progress";

export interface PipelineStage {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
  tone?: Tone;
}

export function WorkingPanel({
  fileName,
  stages,
  progress,
}: {
  fileName: string;
  stages: PipelineStage[];
  progress: number;
}) {
  return (
    <TermWindow title={`analysing — ${fileName}`} right={<StatusChip tone="warn">running</StatusChip>}>
      <Progress value={Math.round(progress * 100)} aria-label="Analysis progress" className="h-1.5" />
      <ul className="mt-4 space-y-2">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-center gap-3 text-sm">
            <StatusChip tone={stage.status === "done" ? "ok" : stage.status === "active" ? "warn" : "muted"}>
              {stage.status === "done" ? "ok" : stage.status === "active" ? "··" : "--"}
            </StatusChip>
            <span
              className={
                stage.status === "pending" ? "text-muted-foreground/70" : "text-foreground"
              }
            >
              {stage.label}
            </span>
            {stage.status === "active" ? (
              <span className="text-ok ml-auto text-xs">working…</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-4 border-border border-t border-dashed pt-3 text-xs">
        Long recordings are scored window by window — the timeline fills in as the analysis walks
        through the clip.
      </p>
    </TermWindow>
  );
}
