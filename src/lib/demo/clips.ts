import type { ClipKind } from "@/lib/audio/synth";

export interface DemoClip {
  id: string;
  synthesis: ClipKind;
  seconds: number;
  fileName: string;
  title: string;
  blurb: string;
  /** What the detector is expected to say about the audio. */
  expected: "real" | "partial" | "ai";
  /** Illustrative transcript shown in the scam-script panel. */
  transcript: string;
  transcriptLanguage: "en" | "hi";
  transcriptNote: string;
}

/**
 * The demo clips are generated in-browser by `synthesizeClip` — they are
 * synthetic illustrations of each signal class, not recordings of real people,
 * and the transcripts are sample scripts for the scam-rule engine.
 */
export const DEMO_CLIPS: DemoClip[] = [
  {
    id: "voice-memo",
    synthesis: "real",
    seconds: 12,
    fileName: "voice-memo.wav",
    title: "Everyday voice memo",
    blurb: "Microphone capture: room tone, hum, reflections and natural pitch drift.",
    expected: "real",
    transcript:
      "Hey, it's me. I'm getting into the meeting now so I'll call you back around seven. Can you pick up some milk on the way home? Thanks, talk soon.",
    transcriptLanguage: "en",
    transcriptNote: "Sample transcript of an ordinary message — no scam indicators.",
  },
  {
    id: "cloned-call",
    synthesis: "clone",
    seconds: 12,
    fileName: "cloned-bank-call.wav",
    title: "Cloned bank call",
    blurb: "Vocoder-like render: digital silence, hard 6.2 kHz bandwidth wall, steady pitch.",
    expected: "ai",
    transcript:
      "Hello, this is Mr Sharma from your bank's account department calling about your KYC update. Your account will be blocked within 24 hours if it is not updated today. To complete the re-verification immediately, please share the OTP we just sent and confirm your UPI PIN. I will send a link so you can install AnyDesk and I can update the account from here.",
    transcriptLanguage: "en",
    transcriptNote: "Sample transcript of a classic bank-KYC scam script.",
  },
  {
    id: "mixed-recording",
    synthesis: "mixed",
    seconds: 12,
    fileName: "mixed-recording.wav",
    title: "Partially edited recording",
    blurb: "Natural first half, cloned second half — exactly what the sliding window catches.",
    expected: "partial",
    transcript:
      "नमस्ते, मैं आपके बैंक से बोल रहा हूँ। आपका केवाईसी अपडेट नहीं है, 24 घंटे में खाता बंद हो जाएगा। कृपया तुरंत भेजा गया ओटीपी बताइए और यूपीआई पिन साझा करें। नहीं तो पुलिस मुकदमा दर्ज करेगी।",
    transcriptLanguage: "hi",
    transcriptNote: "Sample Hindi transcript of a bank-KYC scam script.",
  },
];

export function demoClipById(id: string): DemoClip | undefined {
  return DEMO_CLIPS.find((clip) => clip.id === id);
}
