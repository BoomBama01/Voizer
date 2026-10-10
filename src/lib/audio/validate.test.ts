import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  routeFile,
  validateAudioUpload,
  validateDuration,
} from "./validate";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

const wavHeader = () => {
  const header = new Uint8Array(44);
  header.set(ascii("RIFF"), 0);
  header.set(ascii("WAVE"), 8);
  return header;
};

const mp3Header = () => bytes(0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0, 0, 0); // "ID3"
const mp4Header = () => {
  const header = new Uint8Array(16);
  header.set([0, 0, 0, 0x18], 0);
  header.set(ascii("ftyp"), 4);
  header.set(ascii("M4A "), 8);
  return header;
};
const pngHeader = () => {
  const header = new Uint8Array(16);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return header;
};
const mp4VideoHeader = () => {
  const header = new Uint8Array(16);
  header.set([0, 0, 0, 0x18], 0);
  header.set(ascii("ftyp"), 4);
  header.set(ascii("isom"), 8);
  return header;
};

describe("routeFile", () => {
  it("routes supported audio containers", () => {
    expect(routeFile("clip.wav", wavHeader())).toMatchObject({ kind: "audio", supported: true });
    expect(routeFile("clip.mp3", mp3Header())).toMatchObject({ kind: "audio", supported: true });
    expect(routeFile("clip.m4a", mp4Header())).toMatchObject({ kind: "audio", format: "M4A" });
  });

  it("routes other media to v2 modules with an explanation", () => {
    const image = routeFile("photo.png", pngHeader());
    expect(image.kind).toBe("image");
    expect(image.supported).toBe(false);
    expect(image.reason).toContain("v2");

    const video = routeFile("clip.mp4", mp4VideoHeader());
    expect(video.kind).toBe("video");
    expect(video.supported).toBe(false);
  });

  it("routes loose text", () => {
    const text = routeFile("notes.txt", ascii("just some plain text here"));
    expect(text.kind).toBe("text");
    expect(text.supported).toBe(false);
  });
});

describe("validateAudioUpload", () => {
  it("accepts a small WAV", () => {
    const result = validateAudioUpload("a.wav", 44, wavHeader());
    expect(result.ok).toBe(true);
  });

  it("rejects oversized files with the limit in the message", () => {
    const result = validateAudioUpload("big.wav", 30 * 1024 * 1024, wavHeader());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("25.0 MB");
  });

  it("rejects empty files", () => {
    expect(validateAudioUpload("a.wav", 0, new Uint8Array(0)).ok).toBe(false);
  });

  it("rejects non-audio files even when they claim an audio extension", () => {
    const result = validateAudioUpload("fake.wav", 44, pngHeader());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("v2");
  });
});

describe("validateDuration", () => {
  it("enforces minimum and maximum lengths", () => {
    expect(validateDuration(0.2).ok).toBe(false);
    expect(validateDuration(5).ok).toBe(true);
    expect(validateDuration(700).ok).toBe(false);
  });
});

describe("formatters", () => {
  it("formats bytes and time", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(65)).toBe("65 B");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(9)).toBe("0:09");
  });
});
