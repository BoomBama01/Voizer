import { DETECTOR_PARAMS, type SegmentResult } from "@/lib/audio/detector";
import { TONE_HEX } from "@/lib/ui-meta";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  index: number;
  label: string;
  start: number;
  probability: number;
}

// Recharts sets `fill`/`stroke` as SVG presentation attributes, where var()
// is unreliable — these mirror the theme tokens in src/index.css.
const GRID = "#d8d5c7";
const TICK = "#5c635a";
const CURSOR = "#eceadf";
const BAND = "#96600a";
const THRESHOLD = "#a92d2d";

function toneFor(probability: number): string {
  if (probability >= DETECTOR_PARAMS.flagSegment) return TONE_HEX.risk;
  if (probability >= DETECTOR_PARAMS.uncertainLow) return TONE_HEX.warn;
  return TONE_HEX.ok;
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="border-border bg-card rounded-md border px-3 py-2 text-xs shadow-none">
      <p className="font-bold tracking-tight">window #{point.index + 1}</p>
      <p className="text-muted-foreground mt-0.5 tabular-nums">
        {point.start.toFixed(1)}s – {(point.start + DETECTOR_PARAMS.windowSec).toFixed(1)}s
      </p>
      <p className="mt-1 font-bold tabular-nums" style={{ color: toneFor(point.probability) }}>
        {point.probability.toFixed(1)}% synthetic
      </p>
    </div>
  );
}

/** Per-window probability timeline. Bars are coloured by verdict band. */
export function SegmentTimeline({
  segments,
  durationSec,
}: {
  segments: SegmentResult[];
  durationSec: number;
}) {
  const data: Point[] = segments.map((segment) => ({
    index: segment.index,
    label: String(segment.index + 1),
    start: segment.startSec,
    probability: segment.silent ? 0 : Math.round(segment.probability * 10) / 10,
  }));

  const showSeconds = durationSec > 12;
  const flagged = segments.filter((s) => !s.silent && s.probability >= DETECTOR_PARAMS.flagSegment);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground mono-cap">
          per-window synthetic probability · 4 s windows, 2 s hop
        </span>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {flagged.length} of {segments.length} flagged
        </span>
      </div>

      <div className="border-border bg-background h-56 rounded-md border p-2 pr-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: -18 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
            <ReferenceArea y1={40} y2={60} fill={BAND} fillOpacity={0.09} />
            <ReferenceLine y={60} stroke={THRESHOLD} strokeDasharray="4 4" strokeOpacity={0.7} />
            <XAxis
              dataKey="label"
              tick={{ fill: TICK, fontSize: 10 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              label={
                showSeconds
                  ? { value: "window →", position: "insideBottomRight", fontSize: 10, fill: TICK }
                  : undefined
              }
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 40, 60, 100]}
              tick={{ fill: TICK, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip
              cursor={{ fill: CURSOR, fillOpacity: 0.6 }}
              content={<BarTooltip />}
            />
            <Bar dataKey="probability" radius={[2, 2, 0, 0]} maxBarSize={46}>
              {data.map((point) => (
                <Cell key={point.index} fill={toneFor(point.probability)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2" style={{ background: TONE_HEX.ok }} aria-hidden />
          ≤ 40% likely human
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2" style={{ background: TONE_HEX.warn }} aria-hidden />
          40–65% uncertain band
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2" style={{ background: TONE_HEX.risk }} aria-hidden />
          ≥ 65% flagged synthetic
        </span>
        <span className="ml-auto">silent windows are drawn at 0%</span>
      </div>
    </div>
  );
}
