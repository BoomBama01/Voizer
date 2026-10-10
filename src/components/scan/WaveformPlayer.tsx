import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";

export interface WaveformHighlight {
  start: number;
  end: number;
  probability: number;
}

const REGION_FILL = "rgba(169, 45, 45, 0.16)";
const REGION_FILL_WARN = "rgba(150, 96, 10, 0.14)";

/**
 * Interactive waveform with the flagged 4-second windows highlighted as
 * non-interactive regions.
 */
export function WaveformPlayer({
  blob,
  durationSec,
  highlights,
  fileName,
}: {
  blob: Blob;
  durationSec: number;
  highlights: WaveformHighlight[];
  fileName: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setPlaying(false);
    setCurrent(0);
    setError(null);

    const regions = RegionsPlugin.create();
    const wavesurfer = WaveSurfer.create({
      container,
      height: 96,
      waveColor: "#b9c0b3",
      progressColor: "#1f7a3d",
      cursorColor: "#161b17",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      interact: true,
      dragToSeek: true,
      plugins: [regions],
    });

    const offReady = wavesurfer.on("ready", () => {
      for (const highlight of highlights) {
        regions.addRegion({
          start: Math.max(0, highlight.start),
          end: Math.min(durationSec, Math.max(highlight.start + 0.1, highlight.end)),
          color: highlight.probability >= 65 ? REGION_FILL : REGION_FILL_WARN,
          drag: false,
          resize: false,
        });
      }
    });
    const offPlay = wavesurfer.on("play", () => setPlaying(true));
    const offPause = wavesurfer.on("pause", () => setPlaying(false));
    const offFinish = wavesurfer.on("finish", () => setPlaying(false));
    const offTime = wavesurfer.on("timeupdate", (time) => setCurrent(time));
    const offError = wavesurfer.on("error", (err: Error) => {
      setError(err?.message || "The waveform could not be rendered.");
    });
    wavesurferRef.current = wavesurfer;

    wavesurfer.loadBlob(blob).catch(() => {
      setError("The waveform could not be rendered for this file.");
    });

    return () => {
      offReady();
      offPlay();
      offPause();
      offFinish();
      offTime();
      offError();
      wavesurferRef.current = null;
      wavesurfer.destroy();
    };
  }, [blob, durationSec, highlights]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-muted-foreground mono-cap">waveform · flagged windows shaded</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {current.toFixed(1)}s / {durationSec.toFixed(1)}s
        </span>
      </div>

      <div className="border-border bg-background rounded-md border p-2">
        <div
          ref={containerRef}
          className={cn("min-h-24 w-full", error && "opacity-40")}
          aria-label={`Waveform of ${fileName}`}
        />
        {error ? (
          <p className="text-warn px-2 py-3 text-xs">{error}</p>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={Boolean(error)}
          onClick={() => void wavesurferRef.current?.playPause()}
          className="cursor-pointer gap-1.5 uppercase"
          aria-label={playing ? "Pause playback" : "Play audio"}
        >
          {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {playing ? "pause" : "play"}
        </Button>

        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <span className="bg-risk/30 inline-block h-2.5 w-4 border border-risk/50" aria-hidden />
          window ≥ 65%
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <span className="bg-warn/25 inline-block h-2.5 w-4 border border-warn/50" aria-hidden />
          window 40–65%
        </span>
        <span className="text-muted-foreground ml-auto text-[11px]">click the waveform to seek</span>
      </div>
    </div>
  );
}
