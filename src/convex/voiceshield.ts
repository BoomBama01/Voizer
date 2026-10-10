"use node";
/**
 * VoiceShield server actions.
 *
 * Everything that needs a server (learned anti-spoofing model, Whisper
 * transcription, vocal separation, voice-clone synthesis) runs here so API
 * keys stay in the Convex environment. The browser only ever sees results.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { analyzeTranscript } from "../lib/scam/rules";
import { appendMetadataChunk, buildWatermark } from "../lib/clone/watermark";
import { decodeWavPcm16Base64 } from "../lib/audio/wav";
import { compareSpeakers } from "../lib/audio/speaker";
import {
  callAntiSpoof,
  callTranscription,
  describeProviderError,
  separateVocals,
  synthesizeSpeech,
} from "../lib/server/provider";

/**
 * Longest audio the learned model sees, in seconds. Convex action arguments are
 * size-limited, so very long clips are scored on their first 180 s and the UI
 * says so; the heuristic still covers the whole clip.
 */
export const MAX_REMOTE_SECONDS = 180;

/** Script categories that must never be turned into cloned speech. */
const REFUSED_CATEGORIES = new Set([
  "credential",
  "impersonation",
  "threat",
  "payment",
  "remote_access",
  "data_harvest",
]);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const status = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const ttsProvider = (process.env.VSH_TTS_PROVIDER ?? "openai").toLowerCase();
    return {
      signedIn: identity !== null,
      antiSpoof: Boolean(process.env.VSH_ANTISPOOF_URL),
      transcription: Boolean(process.env.HF_TOKEN),
      tts: Boolean(process.env.VSH_TTS_KEY),
      ttsProvider,
      clonePerHour: envInt("VSH_CLONE_PER_HOUR", 5),
    };
  },
});

/**
 * Ask the deployed wav2vec2/AASIST-style checkpoint for per-window scores.
 * The client falls back to the heuristic when this throws.
 */
export const scoreAudio = action({
  args: {
    audioBase64: v.string(),
    sampleRate: v.number(),
    windowSec: v.optional(v.number()),
    hopSec: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const result = await callAntiSpoof(
      { baseUrl: process.env.VSH_ANTISPOOF_URL, apiKey: process.env.VSH_ANTISPOOF_KEY },
      {
        audioBase64: args.audioBase64,
        sampleRate: args.sampleRate,
        windowSec: args.windowSec ?? 4,
        hopSec: args.hopSec ?? 2,
      },
    );
    return {
      model: result.model,
      license: result.license ?? null,
      global: result.global,
      windows: result.windows,
      latencyMs: result.latencyMs,
    };
  },
});

export const transcribe = action({
  args: { audioBase64: v.string(), mimeType: v.string() },
  handler: async (_ctx, args) => {
    const result = await callTranscription(
      process.env.HF_TOKEN,
      args.audioBase64,
      args.mimeType,
    );
    return { text: result.text, language: result.language ?? null };
  },
});

/**
 * Demucs vocal separation for music-mode scans. The client re-encodes the
 * returned stem and scores it next to the full mix.
 */
export const separateAudio = action({
  args: { audioBase64: v.string() },
  handler: async (_ctx, args) => {
    const vocals = await separateVocals(process.env.VSH_SEPARATE_URL, args.audioBase64);
    if (!vocals) {
      return { ok: false as const, reason: "Separation service not configured or unavailable." };
    }
    return { ok: true as const, vocalsBase64: Buffer.from(vocals).toString("base64") };
  },
});

const refusal = (reason: string) => ({ ok: false as const, reason });

/**
 * Safeguarded voice cloning.
 *
 * Order matters: consent → ownership challenge → text screen → rate limit →
 * provider. The script screen re-runs the exact same rules engine the scan
 * page uses, on the server, so it cannot be bypassed from the client.
 */
type ReserveResult =
  | { allowed: true; id: Id<"cloneJobs">; used: number; limit: number }
  | { allowed: false; used: number; limit: number };

export type CloneResult =
  | {
      ok: true;
      audioBase64: string;
      mimeType: string;
      watermark: string;
      metadataEmbedded: boolean;
      provider: string;
      similarity: number;
      quota: { used: number; limit: number };
    }
  | { ok: false; reason: string };

export const synthesizeClone = action({
  args: {
    text: v.string(),
    referenceBase64: v.string(),
    referenceMime: v.string(),
    referenceSeconds: v.number(),
    /** 8–15 s clip of the same person reading the on-screen challenge phrase. */
    challengeBase64: v.string(),
    consentAccepted: v.boolean(),
  },
  handler: async (ctx, args): Promise<CloneResult> => {
    if (!args.consentAccepted) return refusal("consent-not-given");
    if (args.referenceSeconds < 10 || args.referenceSeconds > 90) {
      return refusal("reference-length");
    }

    // Ownership challenge: the server recomputes the acoustic similarity
    // itself, so a patched client cannot skip it.
    const reference = decodeWavPcm16Base64(args.referenceBase64);
    const challenge = decodeWavPcm16Base64(args.challengeBase64);
    if (!reference || !challenge) return refusal("audio-decode-failed");
    const comparison = compareSpeakers(reference.samples, challenge.samples, reference.sampleRate);
    if (comparison.verdict !== "same") {
      return refusal(`ownership-challenge:${comparison.verdict}`);
    }

    const text = args.text.trim();
    if (text.length < 3) return refusal("empty-text");
    if (text.length > 600) return refusal("text-too-long");

    const analysis = analyzeTranscript(text);
    const hits = analysis.categories.filter((category) => REFUSED_CATEGORIES.has(category));
    if (analysis.level === "high" || hits.length > 0) {
      return refusal(`scam-script:${hits.join(",") || analysis.level}`);
    }

    const identity = (await ctx.auth.getUserIdentity())?.subject ?? "anonymous";
    const limit = envInt("VSH_CLONE_PER_HOUR", 5);
    const reservation: ReserveResult = await ctx.runMutation(
      internal.cloneJobs.reserve,
      { identity, limit },
    );
    if (!reservation.allowed) return refusal("rate-limited");

    try {
      const speech = await synthesizeSpeech(
        {
          provider: process.env.VSH_TTS_PROVIDER,
          baseUrl: process.env.VSH_TTS_BASE_URL,
          apiKey: process.env.VSH_TTS_KEY,
          model: process.env.VSH_TTS_MODEL,
          voice: process.env.VSH_TTS_VOICE,
        },
        {
          text,
          referenceBase64: args.referenceBase64,
          referenceMime: args.referenceMime,
        },
      );

      const watermark = buildWatermark(
        crypto.randomUUID(),
        new Date(),
        speech.provider,
      );
      const tagged = appendMetadataChunk(speech.audio, watermark);
      const metadataEmbedded = tagged.byteLength !== speech.audio.byteLength;

      await ctx.runMutation(internal.cloneJobs.finish, {
        id: reservation.id,
        outcome: "ok",
        reason: `challenge=${comparison.similarity.toFixed(3)}`,
      });

      return {
        ok: true as const,
        audioBase64: Buffer.from(tagged).toString("base64"),
        mimeType: "audio/wav",
        watermark,
        metadataEmbedded,
        provider: speech.provider,
        similarity: comparison.similarity,
        quota: { used: reservation.used, limit: reservation.limit },
      };
    } catch (error) {
      const message = describeProviderError(error);
      await ctx.runMutation(internal.cloneJobs.finish, {
        id: reservation.id,
        outcome: "failed",
        reason: message.slice(0, 200),
      });
      return refusal(`provider-error: ${message}`);
    }
  },
});
