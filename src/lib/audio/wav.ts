/**
 * Minimal PCM16 WAV reader.
 *
 * Both Convex actions (Node) and browser tests need to turn the 16 kHz mono
 * WAVs this app produces back into samples without Web Audio; `decode.ts`
 * stays the browser path for real user files.
 */

export interface Pcm16Wav {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/** Returns null when the buffer is not a RIFF/WAVE with a PCM16 data chunk. */
export function decodeWavPcm16(wav: Uint8Array): Pcm16Wav | null {
  if (wav.byteLength < 44) return null;
  if (ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 4) !== "WAVE") return null;

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= wav.byteLength) {
    const id = ascii(wav, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataLength = Math.min(size, wav.byteLength - dataStart);
    }
    offset += 8 + size + (size % 2);
  }

  if (dataStart < 0 || sampleRate === 0 || channels === 0) return null;
  // WAVE_FORMAT_EXTENSIBLE = 0xFFFE; the sub-format is still PCM16.
  if (format !== 1 && format !== 0xfffe) return null;
  if (bits !== 16) return null;

  const frames = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    // Mixdown to mono.
    let acc = 0;
    for (let channel = 0; channel < channels; channel++) {
      acc += view.getInt16(dataStart + (frame * channels + channel) * 2, true) / 32768;
    }
    samples[frame] = acc / channels;
  }
  return { samples, sampleRate, channels };
}

/** Base64 → bytes, then decode. Returns null on any parse failure. */
export function decodeWavPcm16Base64(base64: string): Pcm16Wav | null {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeWavPcm16(bytes);
}
