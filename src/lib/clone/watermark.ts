/**
 * Provenance watermarking for cloned speech.
 *
 * Every generated clip carries a human-readable comment chunk inside the WAV
 * container (LIST/INFO/ICMT), so anyone who inspects the file — with ffprobe,
 * audacity or a script — can see that it is synthetic and which session made
 * it. The same string is returned to the caller and shown in the UI.
 *
 * Pure functions, no side effects: unit-tested in `watermark.test.ts`.
 */

export const WATERMARK_PREFIX = "VoiceShield-lab synthetic voice";

export function buildWatermark(sessionId: string, createdAt: Date, provider: string): string {
  const stamp = createdAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const short = sessionId.slice(0, 8);
  return `${WATERMARK_PREFIX} | session ${short} | ${stamp} | provider ${provider}`;
}

function ascii(view: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view[offset + i]);
  return out;
}

function chunkSize(view: DataView, offset: number): number {
  return view.getUint32(offset + 4, true);
}

/**
 * Walk RIFF chunks. Returns `{ id, offset, size }` for every chunk header that
 * parses, so callers can insert or read without caring about padding.
 */
function walkChunks(wav: Uint8Array): Array<{ id: string; offset: number; size: number }> {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const chunks: Array<{ id: string; offset: number; size: number }> = [];
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = ascii(wav, offset, 4);
    const size = chunkSize(view, offset);
    chunks.push({ id, offset, size });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function isWav(wav: Uint8Array): boolean {
  return (
    wav.byteLength > 12 &&
    ascii(wav, 0, 4) === "RIFF" &&
    ascii(wav, 8, 4) === "WAVE"
  );
}

function buildInfoChunk(comment: string): Uint8Array {
  const encoder = new TextEncoder();
  const commentBytes = encoder.encode(`${comment}\0`);
  const icmtSize = commentBytes.length;
  const icmtPad = icmtSize % 2;
  // "INFO" + ICMT header (8) + payload + padding
  const listBodySize = 4 + 8 + icmtSize + icmtPad;
  const chunk = new Uint8Array(8 + listBodySize);
  const view = new DataView(chunk.buffer);
  chunk.set(encoder.encode("LIST"), 0);
  view.setUint32(4, listBodySize, true);
  chunk.set(encoder.encode("INFO"), 8);
  chunk.set(encoder.encode("ICMT"), 12);
  view.setUint32(16, icmtSize, true);
  chunk.set(commentBytes, 20);
  return chunk;
}

/**
 * Insert a provenance comment into a WAV file, right after the fmt chunk (or
 * at the end if the layout is unusual). Returns the original bytes untouched
 * when the container is not RIFF/WAVE — callers then keep the textual
 * watermark only.
 */
export function appendMetadataChunk(wav: Uint8Array, comment: string): Uint8Array {
  if (!isWav(wav)) return wav;
  const chunks = walkChunks(wav);
  const fmt = chunks.find((chunk) => chunk.id === "fmt ");
  const insertAt = fmt ? fmt.offset + 8 + fmt.size + (fmt.size % 2) : wav.byteLength;
  if (insertAt > wav.byteLength) return wav;

  const infoChunk = buildInfoChunk(comment);
  const out = new Uint8Array(wav.byteLength + infoChunk.byteLength);
  out.set(wav.subarray(0, insertAt), 0);
  out.set(infoChunk, insertAt);
  out.set(wav.subarray(insertAt), insertAt + infoChunk.byteLength);
  // RIFF size = everything after the first 8 bytes.
  new DataView(out.buffer).setUint32(4, out.byteLength - 8, true);
  return out;
}

/** Read back the provenance comment, or null when the file carries none. */
export function readMetadataComment(wav: Uint8Array): string | null {
  if (!isWav(wav)) return null;
  const list = walkChunks(wav).find((chunk) => chunk.id === "LIST");
  if (!list) return null;
  const start = list.offset + 8;
  if (ascii(wav, start, 4) !== "INFO") return null;
  let offset = start + 4;
  const end = Math.min(start + list.size, wav.byteLength);
  while (offset + 8 <= end) {
    const id = ascii(wav, offset, 4);
    const size = new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(offset + 4, true);
    if (id === "ICMT") {
      const raw = wav.subarray(offset + 8, offset + 8 + size);
      return new TextDecoder().decode(raw).replace(/\0+$/, "");
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}
