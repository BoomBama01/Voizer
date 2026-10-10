/**
 * Client adapter for the learned anti-spoofing backend.
 *
 * The browser keeps doing what it always did (heuristic, per-window cues,
 * explainability); this module is the optional call out to the deployed
 * wav2vec2/AASIST-style checkpoint through a Convex action, which keeps the
 * service URL and key off the client. Everything is injectable so tests run
 * without a network.
 */
import { encodeWav } from "./decode";
import type { LearnedModelResult } from "./ensemble";

/**
 * Longest audio the learned model sees. Convex action arguments are
 * size-limited, so clips longer than this are scored on their first
 * 3 minutes; the heuristic still covers the whole clip and the result says so.
 */
export const MAX_REMOTE_SECONDS = 180;

export interface ScoreAudioArgs {
  audioBase64: string;
  sampleRate: number;
  windowSec?: number;
  hopSec?: number;
}

export interface ScoreAudioPayload {
  model: string;
  license: string | null;
  global: number;
  windows: Array<{ start: number; end: number; p: number }>;
  latencyMs: number;
}

export type ScoreAudioCaller = (args: ScoreAudioArgs) => Promise<ScoreAudioPayload>;

/** Chunked base64 of a WAV blob — avoids stack overflows on big arrays. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, type = "audio/wav"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Ask the learned model for per-window scores. Never throws: a failed call
 * degrades to `available: false` with a human-readable reason, and the
 * pipeline keeps the heuristic-only result.
 */
export async function fetchLearnedScores(
  samples: Float32Array,
  sampleRate: number,
  call: ScoreAudioCaller,
): Promise<LearnedModelResult> {
  const limited =
    samples.length > MAX_REMOTE_SECONDS * sampleRate
      ? samples.subarray(0, MAX_REMOTE_SECONDS * sampleRate)
      : samples;
  const wav = encodeWav(limited, sampleRate);
  try {
    const payload = await call({
      audioBase64: await blobToBase64(wav),
      sampleRate,
      windowSec: 4,
      hopSec: 2,
    });
    return {
      available: true,
      modelId: payload.model,
      license: payload.license ?? undefined,
      globalProbability: payload.global,
      windows: payload.windows.map((window) => ({
        startSec: window.start,
        endSec: window.end,
        probability: window.p,
      })),
      latencyMs: payload.latencyMs,
    };
  } catch (error) {
    return {
      available: false,
      modelId: "unavailable",
      globalProbability: 50,
      windows: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Turn a separation-service payload into a Blob the decoder understands. */
export function vocalsBlobFromBase64(base64: string): Blob {
  return base64ToBlob(base64, "audio/wav");
}
