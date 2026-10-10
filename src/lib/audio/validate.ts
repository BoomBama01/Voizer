/**
 * Input validation: magic-byte sniffing, size limits and module routing.
 *
 * The client never trusts the file extension or the browser MIME type — a file
 * is only accepted for audio analysis when its leading bytes really are a
 * supported container.
 */

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_DURATION_SEC = 600;
export const MIN_DURATION_SEC = 0.75;

export type AudioFormat = "wav" | "mp3" | "m4a" | "ogg" | "flac" | "webm" | "aiff";
export type DetectedKind = "audio" | "image" | "video" | "text" | "unknown";

export interface RouteResult {
  kind: DetectedKind;
  format: string;
  /** True when this build can analyse the file end to end. */
  supported: boolean;
  /** Human-readable reason when the file was rejected. */
  reason?: string;
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

function isEbml(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function ftypBrand(bytes: Uint8Array): string {
  return ascii(bytes, 8, 4);
}

/** Identify the audio container from its leading bytes, or `null`. */
export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.length < 12) return null;
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WAVE")) return "wav";
  if (hasAscii(bytes, 0, "ID3")) return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  if (hasAscii(bytes, 4, "ftyp") && ftypBrand(bytes).startsWith("M4A")) return "m4a";
  if (hasAscii(bytes, 0, "OggS")) return "ogg";
  if (hasAscii(bytes, 0, "fLaC")) return "flac";
  if (isEbml(bytes)) return "webm";
  if (hasAscii(bytes, 0, "FORM")) return "aiff";
  return null;
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "png";
  if (hasAscii(bytes, 0, "GIF8")) return "gif";
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) return "webp";
  if (hasAscii(bytes, 4, "ftyp")) {
    const brand = ftypBrand(bytes);
    if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("msf")) return "heic";
  }
  return null;
}

function sniffVideo(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "AVI ")) return "avi";
  if (isEbml(bytes)) return "matroska";
  if (hasAscii(bytes, 4, "ftyp")) return ftypBrand(bytes).startsWith("qt") ? "mov" : "mp4";
  return null;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "json", "csv", "log", "srt", "vtt", ""]);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    let printable = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable++;
    }
    return printable / Math.max(1, text.length) > 0.9;
  } catch {
    return false;
  }
}

/** Route a dropped file to the module that should handle it. */
export function routeFile(name: string, bytes: Uint8Array): RouteResult {
  const ext = extensionOf(name);

  const audioFormat = sniffAudioFormat(bytes);
  if (audioFormat) {
    const supported = audioFormat !== "aiff";
    return {
      kind: "audio",
      format: audioFormat.toUpperCase(),
      supported,
      reason: supported ? undefined : "AIFF is not supported yet — convert it to WAV first.",
    };
  }

  // ISO-BMFF (ftyp) is shared by M4A, MP4, MOV and HEIC: fall back to the extension.
  if (bytes.length >= 12 && hasAscii(bytes, 4, "ftyp")) {
    if (ext === "m4a" || ext === "m4b") {
      return { kind: "audio", format: "M4A", supported: true };
    }
    const imageFormat = sniffImage(bytes);
    if (imageFormat) {
      return {
        kind: "image",
        format: imageFormat.toUpperCase(),
        supported: false,
        reason: "Image detection ships in v2 — version 1 focuses on voice clones.",
      };
    }
    const videoFormat = sniffVideo(bytes) ?? "MP4";
    return {
      kind: "video",
      format: videoFormat.toUpperCase(),
      supported: false,
      reason: "Video detection ships in v2 — version 1 focuses on voice clones.",
    };
  }

  const imageFormat = sniffImage(bytes);
  if (imageFormat) {
    return {
      kind: "image",
      format: imageFormat.toUpperCase(),
      supported: false,
      reason: "Image detection ships in v2 — version 1 focuses on voice clones.",
    };
  }

  const videoFormat = sniffVideo(bytes);
  if (videoFormat) {
    return {
      kind: "video",
      format: videoFormat.toUpperCase(),
      supported: false,
      reason: "Video detection ships in v2 — version 1 focuses on voice clones.",
    };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      kind: "image",
      format: ext.toUpperCase(),
      supported: false,
      reason: "Image detection ships in v2 — version 1 focuses on voice clones.",
    };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return {
      kind: "video",
      format: ext.toUpperCase(),
      supported: false,
      reason: "Video detection ships in v2 — version 1 focuses on voice clones.",
    };
  }
  if (TEXT_EXTENSIONS.has(ext) || looksLikeText(bytes)) {
    return {
      kind: "text",
      format: ext ? ext.toUpperCase() : "TEXT",
      supported: false,
      reason: "Text authorship detection ships in v2 — version 1 focuses on voice clones.",
    };
  }

  return { kind: "unknown", format: ext || "UNKNOWN", supported: false, reason: "Unrecognised file format." };
}

export interface ValidationOk {
  ok: true;
  format: AudioFormat;
}

export interface ValidationFail {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

/** Size + magic-byte gate for audio uploads. */
export function validateAudioUpload(
  name: string,
  sizeBytes: number,
  bytes: Uint8Array,
): ValidationResult {
  if (sizeBytes === 0) return { ok: false, error: "That file is empty." };
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: `File is ${formatBytes(sizeBytes)} — the limit is ${formatBytes(MAX_AUDIO_BYTES)}.`,
    };
  }
  const route = routeFile(name, bytes);
  if (route.kind !== "audio") {
    return { ok: false, error: route.reason ?? "That does not look like an audio file." };
  }
  if (!route.supported) return { ok: false, error: route.reason ?? "Unsupported audio container." };
  return { ok: true, format: sniffAudioFormat(bytes)! };
}

export function validateDuration(durationSec: number): ValidationResult {
  if (durationSec < MIN_DURATION_SEC) {
    return { ok: false, error: "The clip is too short — record at least a second of speech." };
  }
  if (durationSec > MAX_DURATION_SEC) {
    return {
      ok: false,
      error: `The clip is ${Math.round(durationSec / 60)} min long — the limit is ${MAX_DURATION_SEC / 60} min.`,
    };
  }
  return { ok: true, format: "wav" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
