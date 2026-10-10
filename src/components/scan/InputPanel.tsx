import { StatusChip, TermWindow } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import { DEMO_CLIPS } from "@/lib/demo/clips";
import { cn } from "@/lib/utils";
import { FileAudio, Mic, Square, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_RECORDING_MS = 120_000;

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function InputPanel({
  onPick,
  onDemo,
  disabled = false,
}: {
  onPick: (file: File) => void;
  onDemo: (id: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file || disabled) return;
      onPick(file);
    },
    [disabled, onPick],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    stopTimer();
    setRecording(false);
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone capture is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
          toast.error("The recording came back empty — check your microphone.");
          return;
        }
        onPick(new File([blob], `recording.${type.includes("ogg") ? "ogg" : "webm"}`, { type }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((value) => {
          if (value + 1000 >= MAX_RECORDING_MS) stopRecording();
          return value + 1000;
        });
      }, 1000);
    } catch {
      toast.error("Microphone permission was denied. Upload a file instead.");
    }
  }, [disabled, onPick, stopRecording]);

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload an audio file"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "border-border bg-background flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed px-6 py-10 text-center outline-none transition-colors",
          dragging && "border-ok bg-ok-surface",
          disabled && "pointer-events-none opacity-60",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        )}
      >
        <UploadCloud className={cn("size-7", dragging ? "text-ok" : "text-muted-foreground")} aria-hidden />
        <p className="text-sm font-bold tracking-tight">drop an audio file here</p>
        <p className="text-muted-foreground text-xs">
          wav · mp3 · m4a · ogg · flac · webm — up to 25 MB, 10 min
        </p>
        <span className="border-border hover:bg-accent mt-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors">
          or browse files
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TermWindow title="record live" bodyClassName="p-3" className="h-full">
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {recording ? "recording · max 2:00" : "capture a call as it plays"}
              </span>
              <span className={cn("text-xs font-bold tabular-nums", recording ? "text-risk" : "text-muted-foreground")}>
                {formatClock(elapsed)}
              </span>
            </div>
            <Button
              type="button"
              disabled={disabled}
              variant={recording ? "destructive" : "outline"}
              onClick={() => (recording ? stopRecording() : void startRecording())}
              className="w-full cursor-pointer gap-2 uppercase"
            >
              {recording ? <Square className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
              {recording ? "stop & analyse" : "start recording"}
            </Button>
          </div>
        </TermWindow>

        <TermWindow title="demo mode" bodyClassName="p-3" className="h-full">
          <div className="flex h-full flex-col justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              synthetic clips generated on the fly — no downloads
            </span>
            <div className="grid gap-1.5">
              {DEMO_CLIPS.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onDemo(clip.id)}
                  className="border-border hover:border-ok/60 hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50"
                >
                  <FileAudio className="text-ok size-3.5 shrink-0" aria-hidden />
                  <span className="truncate font-medium">{clip.title}</span>
                  <StatusChip
                    tone={clip.expected === "real" ? "ok" : clip.expected === "ai" ? "risk" : "warn"}
                    className="ml-auto shrink-0"
                  >
                    {clip.expected === "ai" ? "cloned" : clip.expected}
                  </StatusChip>
                </button>
              ))}
            </div>
          </div>
        </TermWindow>
      </div>

      <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
        <span className="text-ok mt-0.5 font-bold" aria-hidden>
          ▸
        </span>
        Everything runs in this tab: your file is decoded, resampled and scored by local code, and
        is never sent anywhere. Closing the tab discards it.
      </p>
    </div>
  );
}
