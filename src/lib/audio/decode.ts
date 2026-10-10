import { ANALYSIS_SAMPLE_RATE } from "./dsp";
import { MAX_DURATION_SEC } from "./validate";

export interface DecodedAudio {
  /** Mono PCM at the analysis rate. */
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  originalSampleRate: number;
  channels: number;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("This browser does not support the Web Audio API.");
  return Ctor;
}

/**
 * Decode any browser-supported container and resample it to the mono 16 kHz
 * analysis stream. Resampling goes through an OfflineAudioContext so the
 * browser's own band-limited converter is used (no aliasing artifacts).
 *
 * Runs entirely on-device: the file never leaves the browser.
 */
export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudio> {
  const Ctor = getAudioContextCtor();
  const arrayBuffer = await blob.arrayBuffer();
  if (arrayBuffer.byteLength === 0) throw new Error("The file is empty.");

  const context = new Ctor();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      "The browser could not decode this file. Try WAV, MP3, M4A, OGG or FLAC.",
    );
  } finally {
    void context.close();
  }

  if (buffer.duration > MAX_DURATION_SEC) {
    throw new Error(
      `The clip is ${Math.round(buffer.duration / 60)} min long — the limit is ${MAX_DURATION_SEC / 60} min.`,
    );
  }
  if (buffer.duration < 0.75) {
    throw new Error("The clip is too short — record at least a second of speech.");
  }

  const length = Math.max(1, Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, ANALYSIS_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return {
    samples: rendered.getChannelData(0).slice(),
    sampleRate: ANALYSIS_SAMPLE_RATE,
    durationSec: rendered.duration,
    originalSampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
  };
}

/** Encode the decoded PCM back to a WAV blob so WaveSurfer can play it. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** SHA-256 of the original upload, shown in the technical details panel. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
