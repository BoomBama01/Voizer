/**
 * Server-side provider clients.
 *
 * These helpers are pure request/response code with an injectable `fetch`, so
 * they can be unit-tested without a network. They are only ever called from
 * Convex actions (`src/convex/*.ts`) — API keys are read from the Convex
 * environment with `process.env` and never reach the browser.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AntiSpoofConfig {
  baseUrl?: string;
  apiKey?: string;
}

export interface AntiSpoofWindow {
  start: number;
  end: number;
  p: number;
}

export interface AntiSpoofResponse {
  model: string;
  license?: string;
  global: number;
  windows: AntiSpoofWindow[];
  latencyMs: number;
}

export interface AudioPayload {
  /** base64 of a 16 kHz mono PCM16 WAV. */
  audioBase64: string;
  sampleRate: number;
  windowSec: number;
  hopSec: number;
}

export class ProviderError extends Error {
  readonly kind: "config" | "network" | "provider" | "bad-response";
  constructor(kind: ProviderError["kind"], message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

const HF_ASR_URL = "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3";

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function clampPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 50;
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError("bad-response", `Non-JSON response (${response.status}).`);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Anti-spoofing model (wav2vec2 / AASIST-style checkpoint)
 * ------------------------------------------------------------------ */

export function antiSpoofUrl(config: AntiSpoofConfig): string {
  if (!config.baseUrl) {
    throw new ProviderError(
      "config",
      "VSH_ANTISPOOF_URL is not set — deploy backend/ (Hugging Face Space or Render) and add the URL to the Convex environment.",
    );
  }
  return `${config.baseUrl.replace(/\/+$/, "")}/v1/score`;
}

/** POST audio to the anti-spoofing service and normalise its response. */
export async function callAntiSpoof(
  config: AntiSpoofConfig,
  payload: AudioPayload,
  fetchImpl: FetchLike = fetch,
): Promise<AntiSpoofResponse> {
  const url = antiSpoofUrl(config);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        audio_base64: payload.audioBase64,
        sample_rate: payload.sampleRate,
        window_sec: payload.windowSec,
        hop_sec: payload.hopSec,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new ProviderError(
      "network",
      `Anti-spoofing service unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      "provider",
      `Anti-spoofing service returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const body = await readJson(response);
  const windowsRaw = Array.isArray(body.windows) ? body.windows : [];
  const windows: AntiSpoofWindow[] = windowsRaw.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    return {
      start: Number(record.start ?? 0),
      end: Number(record.end ?? 0),
      p: clampPercent(record.p ?? record.probability),
    };
  });

  return {
    model: typeof body.model === "string" ? body.model : "unknown-checkpoint",
    license: typeof body.license === "string" ? body.license : undefined,
    global: clampPercent(body.global ?? body.probability),
    windows,
    latencyMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ *
 * 2. Whisper transcription (Hugging Face Inference Providers router)
 * ------------------------------------------------------------------ */

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export async function callTranscription(
  token: string | undefined,
  audioBase64: string,
  mimeType: string,
  fetchImpl: FetchLike = fetch,
): Promise<TranscriptionResult> {
  if (!token) {
    throw new ProviderError(
      "config",
      "HF_TOKEN is not set — add a Hugging Face token with Inference Providers permission to enable auto-transcription.",
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(HF_ASR_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-clientside-audio-format": mimeType,
      },
      body: JSON.stringify({
        inputs: audioBase64,
        parameters: { return_timestamps: false },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new ProviderError(
      "network",
      `Transcription service unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      "provider",
      `Transcription failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const body = await readJson(response);
  if (typeof body.error === "string") {
    throw new ProviderError("provider", body.error);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const language =
    typeof body.language === "string"
      ? body.language
      : typeof body.language_code === "string"
        ? body.language_code
        : undefined;
  if (!text) throw new ProviderError("bad-response", "Transcription returned no text.");
  return { text, language };
}

/* ------------------------------------------------------------------ *
 * 3. Zero-shot voice cloning TTS
 * ------------------------------------------------------------------ */

export type TtsProvider = "cartesia" | "elevenlabs" | "chatterbox" | "openai";

export interface TtsConfig {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
}

export interface SpeechRequest {
  text: string;
  /** base64 reference recording (10–60 s) for zero-shot cloning. */
  referenceBase64: string;
  referenceMime: string;
}

export interface SpeechResponse {
  audio: Uint8Array;
  mimeType: string;
  voiceId?: string;
  provider: TtsProvider;
}

export function resolveTtsProvider(config: TtsConfig): TtsProvider {
  const value = (config.provider ?? "").toLowerCase();
  if (value === "cartesia" || value === "elevenlabs" || value === "chatterbox") return value;
  return "openai";
}

export function requireTtsConfig(config: TtsConfig): { provider: TtsProvider; url: string } {
  const provider = resolveTtsProvider(config);
  if (!config.apiKey && provider !== "chatterbox") {
    throw new ProviderError(
      "config",
      `No TTS key configured (VSH_TTS_PROVIDER=${provider}). Set VSH_TTS_KEY in the Convex environment to enable generation.`,
    );
  }
  if (provider === "chatterbox") {
    if (!config.baseUrl) {
      throw new ProviderError("config", "VSH_TTS_URL is not set for the chatterbox provider.");
    }
    return { provider, url: `${config.baseUrl.replace(/\/+$/, "")}/v1/clone` };
  }
  if (provider === "cartesia") {
    return { provider, url: "https://api.cartesia.ai/tts/bytes" };
  }
  if (provider === "elevenlabs") {
    return { provider, url: "https://api.elevenlabs.io/v1/text-to-speech/from-reference" };
  }
  return { provider, url: `${(config.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "")}/v1/audio/speech` };
}

/**
 * Generate speech in a cloned voice.
 *
 * Every adapter carries the reference clip, so the server never has to store a
 * voice between requests — the caller deletes nothing because nothing persists.
 */
export async function synthesizeSpeech(
  config: TtsConfig,
  request: SpeechRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SpeechResponse> {
  const { provider, url } = requireTtsConfig(config);
  const headers: Record<string, string> = {};
  let body: string;

  if (provider === "cartesia") {
    headers.authorization = `Bearer ${config.apiKey}`;
    headers["Cartesia-Version"] = "2025-04-16";
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      transcript: request.text,
      voice: { mode: "clone", clip: request.referenceBase64 },
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
      ...(config.model ? { model_id: config.model } : {}),
    });
  } else if (provider === "elevenlabs") {
    headers["xi-api-key"] = config.apiKey ?? "";
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      text: request.text,
      voice_description: "Uploaded reference recording",
      audio: request.referenceBase64,
      model_id: config.model ?? "eleven_multilingual_v2",
    });
  } else if (provider === "chatterbox") {
    headers["content-type"] = "application/json";
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    body = JSON.stringify({
      text: request.text,
      reference_audio: request.referenceBase64,
      reference_format: request.referenceMime,
    });
  } else {
    headers.authorization = `Bearer ${config.apiKey}`;
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      model: config.model ?? "gpt-4o-mini-tts",
      input: request.text,
      voice: config.voice ?? "coral",
      response_format: "wav",
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new ProviderError(
      "network",
      `TTS provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      "provider",
      `TTS provider returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "audio/wav";
  if (contentType.includes("application/json")) {
    const bodyJson = await readJson(response);
    if (typeof bodyJson.audio === "string") {
      return { audio: fromBase64(bodyJson.audio), mimeType: "audio/wav", provider };
    }
    if (typeof bodyJson.error === "string") {
      throw new ProviderError("provider", bodyJson.error);
    }
    throw new ProviderError("bad-response", "TTS provider returned JSON without audio.");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) throw new ProviderError("bad-response", "TTS provider returned empty audio.");
  return {
    audio: new Uint8Array(buffer),
    mimeType: contentType.split(";")[0] ?? "audio/wav",
    provider,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Vocal separation (Demucs service)
 * ------------------------------------------------------------------ */

export async function separateVocals(
  baseUrl: string | undefined,
  audioBase64: string,
  fetchImpl: FetchLike = fetch,
): Promise<Uint8Array | null> {
  if (!baseUrl) return null;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/separate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_base64: audioBase64 }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson(response);
    return typeof body.vocals_base64 === "string" ? fromBase64(body.vocals_base64) : null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/* ------------------------------------------------------------------ */

export function describeProviderError(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export const __test = { toBase64, fromBase64 };
