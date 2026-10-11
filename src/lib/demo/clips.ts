export const DEMO_CLIPS = [
  {
    id: "cloned-urgency",
    title: "cloned urgency call",
    synthesis: "clone",
    seconds: 8,
    expected: "ai",
    blurb: "A cloned urgency call asks for an OTP immediately. The demo score reflects the vocoder artifacts left by the synthesis, not whether the script itself is convincing.",
    transcript: "This is the bank fraud team. Your account shows unusual activity. Please confirm your OTP now.",
    transcriptNote: "matches urgency script with OTP request",
    transcriptLanguage: "en",
    fileName: "cloned-urgency.wav",
  },
  {
    id: "real-courier",
    title: "real courier check-in",
    synthesis: "real",
    seconds: 7,
    expected: "real",
    blurb: "A short real recording with natural room tone, breath and pitch drift. It should sit in the likely-human band.",
    transcript: "Hi, I am at the gate. Which entrance should I use for the drop-off?",
    transcriptNote: "ordinary logistics question",
    transcriptLanguage: "en",
    fileName: "real-courier.wav",
  },
  {
    id: "cloned-impostor",
    title: "impersonator asking for transfer",
    synthesis: "clone",
    seconds: 9,
    expected: "ai",
    blurb: "A cloned voice impersonates a known contact and asks for an urgent UPI transfer — both a voice artifact signal and a scam-script signal.",
    transcript: "Amey here. I am stuck at the airport. Can you send Rs 40,000 to this UPI ID right now?",
    transcriptNote: "names a known contact and asks for an urgent transfer",
    transcriptLanguage: "en",
    fileName: "cloned-impostor.wav",
  },
  {
    id: "mixed-spliced",
    title: "spliced clone + real tail",
    synthesis: "mixed",
    seconds: 10,
    expected: "ai",
    blurb: "A spliced recording: the first half is synthesised and the tail is real, so the timeline should show a flagged region at the start.",
    transcript: "Please verify your Aadhaar and PIN. The partial payment has failed.",
    transcriptNote: "first half synthesised, tail is real",
    transcriptLanguage: "en",
    fileName: "mixed-spliced.wav",
  },
] as const;

export type DemoClipId = (typeof DEMO_CLIPS)[number]["id"];

export function demoClipById(id: string): (typeof DEMO_CLIPS)[number] | null {
  return (DEMO_CLIPS.find((c) => c.id === id) ?? null) as (typeof DEMO_CLIPS)[number] | null;
}
