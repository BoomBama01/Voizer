import { computeSpectrogram, type Spectrogram } from "@/lib/audio/spectrogram";
import { useEffect, useMemo, useRef, useState } from "react";

const HEIGHT = 200;

/** Light, paper-to-ink-green ramp so the plot stays legible on off-white. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [245, 244, 236]],
  [0.22, [214, 229, 211]],
  [0.45, [147, 195, 160]],
  [0.7, [63, 138, 92]],
  [0.88, [24, 74, 45]],
  [1, [12, 34, 21]],
];

function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const f = (x - t0) / Math.max(1e-6, t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

const Y_TICKS = [120, 500, 1000, 2000, 4000, 8000];

export function SpectrogramPanel({
  samples,
  sampleRate,
  durationSec,
  flagged,
}: {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  /** [startSec, endSec] pairs of flagged windows. */
  flagged: Array<[number, number]>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);

  const spectrogram = useMemo<Spectrogram>(
    () => computeSpectrogram(samples, sampleRate, { cols: Math.max(320, Math.round(width)), rows: 220 }),
    // Recomputing on every resize would be wasteful; width is only used for the
    // initial column count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, sampleRate],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.max(240, Math.round(entries[0].contentRect.width));
      setWidth((prev) => (Math.abs(prev - next) > 16 ? next : prev));
    });
    observer.observe(wrap);
    setWidth(Math.max(240, Math.round(wrap.getBoundingClientRect().width)));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = Math.max(240, width);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { cols, rows, data, minDb, maxDb } = spectrogram;
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    const image = offCtx.createImageData(cols, rows);
    const range = Math.max(1e-6, maxDb - minDb);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const value = data[c * rows + r];
        const t = (value - minDb) / range;
        const [red, green, blue] = ramp(t);
        const offset = (c * rows + r) * 4;
        image.data[offset] = red;
        image.data[offset + 1] = green;
        image.data[offset + 2] = blue;
        image.data[offset + 3] = 255;
      }
    }
    offCtx.putImageData(image, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Flagged windows, tinted over the plot.
    const scaleX = canvas.width / Math.max(1e-6, durationSec);
    for (const [start, end] of flagged) {
      const x = start * scaleX;
      const w = Math.max(2, (end - start) * scaleX);
      ctx.fillStyle = "rgba(169, 45, 45, 0.16)";
      ctx.fillRect(x, 0, w, canvas.height);
      ctx.fillStyle = "rgba(169, 45, 45, 0.85)";
      ctx.fillRect(x, 0, w, Math.max(2, 2 * dpr));
    }
  }, [spectrogram, width, flagged, durationSec]);

  const labelStyle = { fontFamily: "inherit" } as const;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-muted-foreground mono-cap">spectrogram · 60 Hz – 8 kHz (log)</span>
        <span className="text-muted-foreground text-[11px]">{durationSec.toFixed(1)} s</span>
      </div>

      <div className="border-border bg-background relative rounded-md border">
        <div className="flex">
          <div
            className="text-muted-foreground relative w-10 shrink-0"
            style={{ height: HEIGHT }}
            aria-hidden
          >
            {Y_TICKS.map((hz) => {
              const top =
                (Math.log(hz / 60) / Math.log(spectrogram.maxHz / 60)) * (HEIGHT - 16) + 8;
              return (
                <span
                  key={hz}
                  className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums"
                  style={{ top, ...labelStyle }}
                >
                  {hz >= 1000 ? `${hz / 1000}k` : hz}
                </span>
              );
            })}
          </div>
          <div ref={wrapRef} className="min-w-0 flex-1 py-2">
            <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label="Spectrogram of the analysed audio" />
          </div>
        </div>
      </div>
    </div>
  );
}
