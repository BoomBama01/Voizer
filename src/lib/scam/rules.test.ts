import { describe, expect, it } from "vitest";
import { analyzeTranscript, detectLanguage, mergeSpans } from "./rules";
import { combineRisk } from "./risk";

const BENIGN =
  "Hey, it's me. I'm getting into the meeting now so I'll call you back around seven.";

const ENGLISH_SCAM =
  "Hello, this is Mr Sharma from your bank's account department calling about your KYC update. " +
  "Your account will be blocked within 24 hours if it is not updated today. " +
  "To complete the re-verification immediately, please share the OTP we just sent and confirm your UPI PIN. " +
  "Install AnyDesk so I can update the account from here.";

const HINDI_SCAM =
  "नमस्ते, मैं आपके बैंक से बोल रहा हूँ। आपका केवाईसी अपडेट नहीं है, 24 घंटे में खाता बंद हो जाएगा। " +
  "कृपया तुरंत भेजा गया ओटीपी बताइए और यूपीआई पिन साझा करें।";

const KANNADA_SCAM =
  "ನಮಸ್ಕಾರ, ನಿಮ್ಮ ಬ್ಯಾಂಕ್ ಅಧಿಕಾರಿ ಮಾತಾಡುತ್ತಿದ್ದೇನೆ. ತಕ್ಷಣ ಒಟಿಪಿ ಕಳುಹಿಸಿ ಮತ್ತು ಹಣ ವರ್ಗಾಯಿಸಿ.";

describe("detectLanguage", () => {
  it("identifies Latin, Devanagari and Kannada scripts", () => {
    expect(detectLanguage(BENIGN)).toBe("en");
    expect(detectLanguage(HINDI_SCAM)).toBe("hi");
    expect(detectLanguage(KANNADA_SCAM)).toBe("kn");
    expect(detectLanguage("1234 !!!")).toBe("unknown");
  });
});

describe("analyzeTranscript", () => {
  it("does not flag an ordinary message", () => {
    const result = analyzeTranscript(BENIGN);
    expect(result.score).toBeLessThan(15);
    expect(result.level).toBe("none");
    expect(result.flags).toHaveLength(0);
    expect(result.categories).toHaveLength(0);
  });

  it("flags and explains an English bank scam script", () => {
    const result = analyzeTranscript(ENGLISH_SCAM);
    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.matchedRules).toContain("otp");
    expect(result.matchedRules).toContain("remote_access");
    expect(result.matchedRules).toContain("urgency");
    expect(result.flags.some((f) => f.phrase.toLowerCase() === "anydesk")).toBe(true);
    for (const flag of result.flags) {
      expect(flag.explain.length).toBeGreaterThan(30);
      expect(ENGLISH_SCAM.slice(flag.start, flag.end)).toBe(flag.phrase);
    }
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("flags a Hindi script in Devanagari", () => {
    const result = analyzeTranscript(HINDI_SCAM);
    expect(result.language).toBe("hi");
    expect(result.level).toBe("high");
    expect(result.matchedRules).toContain("otp");
    expect(result.matchedRules).toContain("urgency");
    expect(result.flags.map((f) => f.phrase)).toContain("ओटीपी");
    expect(result.flags.map((f) => f.phrase)).toContain("तुरंत");
  });

  it("flags a Kannada script", () => {
    const result = analyzeTranscript(KANNADA_SCAM);
    expect(result.language).toBe("kn");
    expect(result.level).toBe("high");
    expect(result.matchedRules).toContain("payment");
    expect(result.matchedRules).toContain("otp");
  });

  it("does not match words inside longer words", () => {
    expect(analyzeTranscript("What a whopping stroke of luck!").matchedRules).toHaveLength(0);
  });

  it("returns an empty analysis for blank input", () => {
    const result = analyzeTranscript("   ");
    expect(result.score).toBe(0);
    expect(result.flags).toHaveLength(0);
  });
});

describe("mergeSpans", () => {
  it("merges overlapping highlights and keeps order", () => {
    const result = analyzeTranscript(ENGLISH_SCAM);
    const spans = mergeSpans(result.flags);
    expect(spans.length).toBeLessThanOrEqual(result.flags.length);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThan(spans[i - 1].end);
    }
  });
});

describe("combineRisk", () => {
  it("stays safe for a natural voice and a benign script", () => {
    const risk = combineRisk(3, "real", 0);
    expect(risk.level).toBe("safe");
    expect(risk.score).toBeLessThan(35);
  });

  it("goes high risk when the voice is cloned", () => {
    const risk = combineRisk(88, "ai", 0);
    expect(risk.level).toBe("high");
    expect(risk.reason).toContain("synthesis artifacts");
  });

  it("goes high risk for a scripted scam in a natural voice", () => {
    const risk = combineRisk(4, "real", 95);
    expect(risk.level).toBe("high");
    expect(risk.reason).toContain("scam script");
  });

  it("flags partially cloned audio even without a transcript", () => {
    const risk = combineRisk(51, "partial", 0);
    expect(risk.voiceRisk).toBe(70);
    expect(risk.level).toBe("high");
  });

  it("marks an inconclusive analysis as suspicious rather than safe", () => {
    const risk = combineRisk(50, "uncertain", 0);
    expect(risk.level).toBe("suspicious");
  });
});
