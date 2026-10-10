/**
 * Music detection.
 *
 * A song scored as "speech" produces nonsense verdicts: sustained harmony,
 * steady beat and bass energy are not synthesis artifacts. Before scoring a
 * file we check whether it looks like music; if it does, the pipeline
 * (optionally) separates the vocals with Demucs and reports both the vocal
 * stem and the full mix.
 *
 * Three cheap, deterministic cues are combined:
 *  1. beat regularity — autocorrelation of the energy envelope (music keeps
 *     time; speech does not),
 *  2. sustain — speech pauses constantly, music sustains (long voiced runs),
 *  3. bass dominance — steady low-frequency energy below 250 Hz.
 */

export interface MusicReport {
  isMusic: boolean;
  confidence: number;
  metrics: { beat: number; sustain: number; bass: number };
  reason: string;
}

const FRAME = 320; // 20 ms at 16 kHz

export function detectMusic(samples: Float32Array, sampleRate = 16000): MusicReport {
  const frames = Math.max(1, Math.floor(samples.length / FRAME));
  const envelope = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[f * FRAME + i] ?? 0;
      acc += s * s;
    }
    envelope[f] = Math.sqrt(acc / FRAME);
  }

  // --- 1. beat regularity -------------------------------------------------
  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= frames || 1;
  let variance = 0;
  for (const value of envelope) variance += (value - mean) ** 2;
  variance /= frames || 1;
  const beat =
    variance < 1e-8
      ? 0
      : (() => {
          let best = 0;
          const minLag = Math.max(2, Math.floor((0.4 * sampleRate) / FRAME));
          const maxLag = Math.min(frames - 2, Math.floor((2.5 * sampleRate) / FRAME));
          for (let lag = minLag; lag <= maxLag; lag++) {
            let acc = 0;
            for (let i = 0; i + lag < frames; i++) {
              acc += (envelope[i] - mean) * (envelope[i + lag] - mean);
            }
            acc /= frames - lag;
            best = Math.max(best, acc / variance);
          }
          return Math.max(0, Math.min(1, (best - 1.2) / 1.6));
        })();

  // --- 2. sustain ---------------------------------------------------------
  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  const threshold = 0.25 * peak;
  let longest = 0;
  let run = 0;
  for (const value of envelope) {
    if (value >= threshold) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  const sustain = Math.max(0, Math.min(1, longest / frames / 0.8));

  // --- 3. bass dominance --------------------------------------------------
  // One-pole low-pass at ~250 Hz as a cheap stand-in for an FFT band split.
  const alpha = 1 - Math.exp((-2 * Math.PI * 250) / sampleRate);
  let lp = 0;
  let lowPower = 0;
  let totalPower = 0;
  for (let i = 0; i < samples.length; i++) {
    lp += alpha * (samples[i] - lp);
    lowPower += lp * lp;
    totalPower += samples[i] * samples[i];
  }
  const bass = totalPower > 1e-9 ? Math.min(1, (lowPower / totalPower) / 0.35) : 0;

  const confidence = Math.max(
    0,
    Math.min(1, 0.45 * beat + 0.3 * sustain + 0.25 * bass),
  );
  const isMusic = confidence >= 0.62;

  const parts: string[] = [];
  if (beat > 0.5) parts.push("regular beat");
  if (sustain > 0.5) parts.push("sustained passages without speech pauses");
  if (bass > 0.5) parts.push("strong steady bass energy");

  return {
    isMusic,
    confidence,
    metrics: { beat, sustain, bass },
    reason: isMusic
      ? `Looks like a song/mix (${parts.join(", ") || "combined cues"}).`
      : "Looks like speech — no sustained musical structure detected.",
  };
}
