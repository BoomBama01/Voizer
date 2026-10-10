/**
 * Scam-script detection for phone transcripts (English, Hindi, Kannada).
 *
 * Each rule is a plain-language indicator used by Indian and international
 * voice-phishing scripts. Rules match phrases, never whole sentences, so the UI
 * can highlight exactly what triggered the flag and explain why.
 */

export type ScamCategory =
  | "urgency"
  | "credential"
  | "impersonation"
  | "threat"
  | "payment"
  | "remote_access"
  | "too_good"
  | "data_harvest";

export type TranscriptLanguage = "en" | "hi" | "kn" | "unknown";

export interface ScamRule {
  id: string;
  category: ScamCategory;
  label: string;
  explain: string;
  /** Risk contribution of this indicator when matched (0..1). */
  weight: number;
  patterns: RegExp[];
}

export interface FlaggedPhrase {
  ruleId: string;
  category: ScamCategory;
  label: string;
  explain: string;
  phrase: string;
  start: number;
  end: number;
  weight: number;
}

export type ScamLevel = "none" | "low" | "medium" | "high";

export interface ScamAnalysis {
  score: number;
  level: ScamLevel;
  language: TranscriptLanguage;
  flags: FlaggedPhrase[];
  matchedRules: string[];
  categories: ScamCategory[];
  summary: string[];
}

// JavaScript's `\b` only understands ASCII word characters, which never matches
// around Devanagari or Kannada text. We therefore strip `\b` from each pattern
// and wrap it in Unicode-aware boundary lookarounds instead.
const BOUNDARY_START = "(?<![\\p{L}\\p{N}_])";
const BOUNDARY_END = "(?![\\p{L}\\p{N}_])";

const rule = (
  id: string,
  category: ScamCategory,
  label: string,
  explain: string,
  weight: number,
  patterns: string[],
): ScamRule => ({
  id,
  category,
  label,
  explain,
  weight,
  patterns: patterns.map(
    (p) => new RegExp(`${BOUNDARY_START}${p.replace(/\\b/g, "")}${BOUNDARY_END}`, "giu"),
  ),
});

export const SCAM_RULES: ScamRule[] = [
  rule(
    "urgency",
    "urgency",
    "Artificial urgency",
    "Scammers compress your decision time so you act before you think. Real institutions give you a window to verify.",
    0.3,
    [
      "\\bimmediately\\b",
      "\\bright now\\b",
      "\\bwithin \\d+ (minutes|hours|days)\\b",
      "\\blast (warning|notice|chance)s?\\b",
      "\\bexpire[sd]? (today|now|soon)\\b",
      "\\bact now\\b",
      "\\bonly \\d+ (minutes|hours) left\\b",
      "\\bbefore (it|this) (is )?too late\\b",
      "\\bturant\\b",
      "\\bfauran\\b",
      "\\bjaldi( se jaldi)?\\b",
      "\\bतुरंत\\b",
      "\\bफौरन\\b",
      "\\bजल्दी\\b",
      "\\bತಕ್ಷಣ\\b",
      "\\bಈಗಲೇ\\b",
      "\\bಬೇಗನೆ\\b",
    ],
  ),
  rule(
    "otp",
    "credential",
    "OTP / PIN request",
    "No bank, courier or government agency ever asks for an OTP, PIN or CVV. Sharing one hands over your account.",
    0.62,
    [
      "\\bOTP\\b",
      "\\bone[- ]time password\\b",
      "\\bverification code\\b",
      "\\bCVV\\b",
      "\\bATM PIN\\b",
      "\\baccount PIN\\b",
      "\\bPIN number\\b",
      "\\bshare (the )?code\\b",
      "\\btell me the code\\b",
      "\\bकोड बताइए\\b",
      "\\bओटीपी\\b",
      "\\bपिन\\b",
      "\\bಒಟಿಪಿ\\b",
      "\\bಪಿನ್\\b",
      "\\botp bhejo\\b",
      "\\botp bataye\\b",
    ],
  ),
  rule(
    "kyc",
    "credential",
    "KYC / account verification ruse",
    "Fake KYC or \"account will close\" calls are a standard pretext to harvest credentials or install remote-access software.",
    0.34,
    [
      "\\bKYC\\b",
      "\\bKYC (update|refresh|expir)",
      "\\bupdate your (account|kyc|details)\\b",
      "\\baccount (will be|is being|shall be) (blocked|closed|frozen)\\b",
      "\\bre[- ]verification\\b",
      "\\bकेवाईसी\\b",
      "\\bಕೆವೈಸಿ\\b",
    ],
  ),
  rule(
    "bank_impersonation",
    "impersonation",
    "Bank / RBI impersonation",
    "Callers claiming to be from a bank or the RBI are the most common voice-phishing script. Hang up and call the number on your card.",
    0.3,
    [
      "\\bfrom (the )?RBI\\b",
      "\\bReserve Bank of India\\b",
      "\\bbank (official|officer|representative|department)\\b",
      "\\byour bank\\b",
      "\\baccount department\\b",
      "\\bहमारा बैंक\\b",
      "\\bबैंक\\s*से\\b",
      "\\bबैंक अधिकारी\\b",
      "\\bಬ್ಯಾಂಕ್\\s*ಅಧಿಕಾರಿ\\b",
      "\\bbank se baat\\b",
    ],
  ),
  rule(
    "authority_impersonation",
    "impersonation",
    "Police / government impersonation",
    "Police, tax and courier departments do not settle matters over an unsolicited call or demand immediate payment.",
    0.34,
    [
      "\\bcyber (crime )?(cell|police|team)\\b",
      "\\bfrom the police\\b",
      "\\bincome tax (department|officer)\\b",
      "\\bcustoms (department|officer)?\\b",
      "\\bpassport (office|department|official)\\b",
      "\\bcourt (summons|notice|order)\\b",
      "\\bनोटिस भेजी जाएगी\\b",
      "\\bपुलिस\\b",
      "\\bआयकर विभाग\\b",
      "\\bಸೈಬರ್ ಪೊಲೀಸ್\\b",
      "\\bಪೊಲೀಸ್\\b",
      "\\bcourier (se|wala) parcel\\b",
    ],
  ),
  rule(
    "threat",
    "threat",
    "Threat of arrest or penalty",
    "Threatening arrest, blocklists or criminal records is designed to panic you into complying.",
    0.4,
    [
      "\\barrest\\b",
      "\\bwarrant\\b",
      "\\bcase (will be )?(filed|registered)\\b",
      "\\blegal action\\b",
      "\\bjail\\b",
      "\\bblacklist\\b",
      "\\bगिरफ्तार\\b",
      "\\bमुकदमा\\b",
      "\\bಬಂಧನ\\b",
      "\\bಕೇಸ್\\s*ದಾಖಲಾಗುತ್ತದೆ\\b",
      "\\bblocked permanently\\b",
    ],
  ),
  rule(
    "payment",
    "payment",
    "Request to transfer money",
    "Requests to move money — by UPI, gift card, wire or crypto — are the endgame of nearly every scam script.",
    0.46,
    [
      "\\btransfer (money|funds|₹|rs\\.?)",
      "\\bsend (money|payment)\\b",
      "\\bpay (₹|rs\\.?|inr)\\s?\\d",
      "\\bUPI\\b",
      "\\bGoogle Pay\\b",
      "\\bGPay\\b",
      "\\bPaytm\\b",
      "\\bPhonePe\\b",
      "\\bIMPS\\b",
      "\\bNEFT\\b",
      "\\bgift card\\b",
      "\\bbitcoin\\b",
      "\\bcrypto\\b",
      "\\bWestern Union\\b",
      "\\bयूपीआई\\b",
      "\\bगूगल पे\\b",
      "\\bपेटीएम\\b",
      "\\bपैसे भेजें\\b",
      "\\bरकम ट्रांसफर\\b",
      "\\bಯುಪಿಐ\\b",
      "\\bಗೂಗಲ್\\s*ಪೇ\\b",
      "\\bಹಣ (ಕಳುಹಿಸಿ|ವರ್ಗಾಯಿಸಿ)\\b",
    ],
  ),
  rule(
    "remote_access",
    "remote_access",
    "Remote-access app request",
    "Screen-sharing or remote-desktop apps give the caller control of your phone or laptop — a decisive red flag.",
    0.62,
    [
      "\\bAnyDesk\\b",
      "\\bTeamViewer\\b",
      "\\bscreen shar\\w*\\b",
      "\\bremote (desktop|access|support)\\b",
      "\\binstall (this|the|an?) (app|application)\\b",
      "\\bLogMeIn\\b",
      "\\bQuickSupport\\b",
      "\\bअनीडेस्क\\b",
      "\\bस्क्रीन शेयर\\b",
      "\\bಎನಿಡೆಸ್ಕ್\\b",
      "\\bಸ್ಕ್ರೀನ್\\s*ಹಂಚಿಕೆ\\b",
    ],
  ),
  rule(
    "too_good",
    "too_good",
    "Prize / lottery lure",
    "Unexpected winnings are used to extract \"fees\" or credentials before any prize exists.",
    0.36,
    [
      "\\byou have won\\b",
      "\\bwon the lottery\\b",
      "\\bjackpot\\b",
      "\\bprize (money|winning)\\b",
      "\\bलॉटरी\\b",
      "\\bಬಹುಮಾನ\\b",
      "\\bcongratulations, you\\b",
    ],
  ),
  rule(
    "data_harvest",
    "data_harvest",
    "Personal data request",
    "Aadhaar numbers, card details and passwords are never required to \"verify\" an account on a call.",
    0.44,
    [
      "\\bAadhaar\\b",
      "\\bAadhar\\b",
      "\\bcard number\\b",
      "\\bexpiry date\\b",
      "\\bpassword\\b",
      "\\bsocial security\\b",
      "\\bsignature\\b",
      "\\bआधार नंबर\\b",
      "\\bಕಾರ್ಡ್\\s*ಸಂಖ್ಯೆ\\b",
    ],
  ),
];

export const CATEGORY_LABELS: Record<ScamCategory, string> = {
  urgency: "Urgency",
  credential: "Credential theft",
  impersonation: "Impersonation",
  threat: "Intimidation",
  payment: "Money transfer",
  remote_access: "Remote access",
  too_good: "Too good to be true",
  data_harvest: "Personal data",
};

/** Detect the dominant script of a transcript. */
export function detectLanguage(text: string): TranscriptLanguage {
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const kannada = (text.match(/[\u0C80-\u0CFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const counts: Array<[TranscriptLanguage, number]> = [
    ["hi", devanagari],
    ["kn", kannada],
    ["en", latin],
  ];
  const sorted = counts.sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return "unknown";
  return sorted[0][0];
}

function levelFor(score: number): ScamLevel {
  if (score < 15) return "none";
  if (score < 40) return "low";
  if (score < 65) return "medium";
  return "high";
}

const CATEGORY_TIPS: Record<ScamCategory, string> = {
  urgency: "Slow down — genuine institutions never demand an instant decision.",
  credential: "Never read out an OTP, PIN or CVV to anyone, including someone claiming to be your bank.",
  impersonation: "Hang up and call the organisation on its official number, not the one the caller gives you.",
  threat: "Officials do not arrest or prosecute people over an unsolicited phone call.",
  payment: "Do not transfer money or buy gift cards for someone who called you.",
  remote_access: "Never install a remote-access app at a caller's request.",
  too_good: "If you did not enter a draw, you did not win one.",
  data_harvest: "Do not share Aadhaar, card or password details on an inbound call.",
};

/**
 * Analyse a transcript: highlight every matched phrase, explain it, and turn the
 * matched rules into a 0–100 script-risk score.
 */
export function analyzeTranscript(text: string): ScamAnalysis {
  const trimmed = text.trim();
  const language = detectLanguage(trimmed);
  if (!trimmed) {
    return {
      score: 0,
      level: "none",
      language,
      flags: [],
      matchedRules: [],
      categories: [],
      summary: [],
    };
  }

  const flags: FlaggedPhrase[] = [];
  const matched = new Map<string, { rule: ScamRule; count: number }>();

  for (const r of SCAM_RULES) {
    for (const pattern of r.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(trimmed)) !== null) {
        const phrase = match[0];
        flags.push({
          ruleId: r.id,
          category: r.category,
          label: r.label,
          explain: r.explain,
          phrase,
          start: match.index,
          end: match.index + phrase.length,
          weight: r.weight,
        });
        const entry = matched.get(r.id) ?? { rule: r, count: 0 };
        entry.count++;
        matched.set(r.id, entry);
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
        if (flags.length > 400) break;
      }
    }
  }

  flags.sort((a, b) => a.start - b.start || a.end - b.end);

  // Saturating sum: many distinct indicators approach 100, repeats add little.
  let weightSum = 0;
  for (const { rule: r, count } of matched.values()) {
    weightSum += r.weight * Math.min(1.5, 1 + 0.25 * (count - 1));
  }
  const score = Math.round(Math.min(100, 100 * (1 - Math.exp(-1.35 * weightSum))));
  const categories = Array.from(
    new Set(Array.from(matched.values()).map((m) => m.rule.category)),
  );
  const summary = categories.map((c) => CATEGORY_TIPS[c]);

  return {
    score,
    level: levelFor(score),
    language,
    flags,
    matchedRules: Array.from(matched.keys()),
    categories,
    summary,
  };
}

/** Merge contiguous flagged spans so the UI can render clean highlights. */
export function mergeSpans(flags: FlaggedPhrase[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const flag of flags) {
    const last = spans[spans.length - 1];
    if (last && flag.start <= last.end + 1) {
      last.end = Math.max(last.end, flag.end);
    } else {
      spans.push({ start: flag.start, end: flag.end });
    }
  }
  return spans;
}
