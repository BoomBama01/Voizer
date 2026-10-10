# VoiceShield AI

**A public, in-browser detector for AI-generated and cloned voice recordings — with scam-script analysis for phone transcripts.**

> Detection is probabilistic, not proof. Never rely on a single result to move money or to accuse someone.

Version 1 ships one deep, tested path: **voice-clone detection for public users**. Image, video and text detectors are deliberately routed to a clear "v2" notice rather than faked.

---

## Table of contents

- [What v1 does](#what-v1-does)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [How the detector works](#how-the-detector-works)
- [Scam-script engine](#scam-script-engine)
- [Demo mode](#demo-mode)
- [Privacy model](#privacy-model)
- [Testing & quality](#testing--quality)
- [Module API reference](#module-api-reference)
- [Three-minute demo script](#three-minute-demo-script)
- [Roadmap (v2+)](#roadmap-v2)
- [Limitations](#limitations)

---

## What v1 does

| Capability | Status in v1 |
| --- | --- |
| Audio upload (wav / mp3 / m4a / ogg / flac / webm, ≤ 25 MB) | ✅ magic-byte verified |
| Live microphone recording | ✅ (Web Audio + MediaRecorder) |
| AI-generated vs human probability, verdict, confidence | ✅ calibrated, with a 40–60% **uncertain** band |
| Waveform + spectrogram with flagged windows | ✅ WaveSurfer.js + canvas |
| Sliding 4-second window analysis (catches partial clones) | ✅ 2 s hop |
| Plain-language explainability ("why was this flagged?") | ✅ per-cue contribution bars |
| Scam-script transcript analysis (English, हिन्दी, ಕನ್ನಡ) | ✅ rule engine, highlighted phrases |
| Combined risk meter (Safe / Suspicious / High Risk) | ✅ voice score + script score |
| Check-Anything routing for image/video/text files | ✅ routes with an honest v2 notice |
| Demo mode with sample clips | ✅ synthetic clips generated on the fly |
| SHA-256 fingerprint, technical details, delete-now | ✅ |
| Auth, history, PDF reports, public REST API, admin | ⏳ v2 (out of scope for v1) |

---

## Quick start

```bash
bun install       # install dependencies
bun run dev       # start the dev server (Freebuff runs this for you)
bun test          # 48 unit + integration tests (Vitest)
bun tsc -b --noEmit
bunx eslint src/pages src/components src/lib
```

Open `/` for the landing page, `/scan` for the scanner, or jump straight to a demo:

```
/scan?demo=voice-memo     # natural recording  → LIKELY HUMAN
/scan?demo=cloned-call    # cloned bank call   → LIKELY AI-GENERATED + HIGH RISK
/scan?demo=mixed-recording# half-edited clip   → PARTIALLY SYNTHETIC
```

There is no server-side component to configure: every byte of analysis happens in the browser tab. The Convex backend is only used by the template's optional auth flow (`/auth`, protected `/dashboard`).

---

## Architecture

```
                       ┌──────────────────────────────────────────────┐
  browser tab          │                  VoiceShield AI             │
                       │                                              │
  file / mic  ──────►  │  validate.ts   magic bytes, size, duration   │
  demo clip   ──────►  │  decode.ts     WebAudio decode → 16 kHz mono │
                       │       │                                      │
                       │       ├─► spectrogram.ts  log-freq image     │
                       │       ├─► features.ts     per-window cues    │
                       │       │      └─ fft.ts (radix-2) + dsp.ts    │
                       │       └─► detector.ts     scoring, verdict,  │
                       │                         calibration, explain │
                       │                                              │
  transcript  ──────►  │  scam/rules.ts   EN / हिन्दी / ಕನ್ನಡ flags   │
                       │  scam/risk.ts    voice + script → risk meter │
                       │                                              │
                       │  pages/Landing.tsx     marketing + FAQ       │
                       │  pages/Scan.tsx        pipeline + results    │
                       │       └─ components/scan/*  result UI        │
                       └──────────────────────────────────────────────┘
                              ▲  no network requests for analysis
                              │
                    optional: Convex auth (template)
```

Folder layout:

```
src/
  components/
    Terminal.tsx            terminal-themed primitives (status chips, panes)
    site/                   header + footer
    scan/                   input panel, progress, result panels
    ui/                     shadcn/ui primitives (theme tokens in index.css)
  lib/
    audio/                  FFT, DSP, features, detector, spectrogram,
                            browser decode, validation, demo synthesiser
    scam/                   transcript rules + combined risk meter
    demo/                   demo clip definitions
    ui-meta.ts              verdict / risk / confidence display metadata
  pages/                    Landing, Scan, Auth, Dashboard
  test/app.test.tsx         render + end-to-end demo flow tests
  convex/                   template auth (unchanged)
```

---

## How the detector works

**Model id: `vsa-heuristic-0.1`** — a signal-heuristic baseline. It is intentionally *not* a black box: every result shows the measurements behind the number.

1. **Decode & resample.** The upload is decoded with the Web Audio API and resampled to 16 kHz mono through an `OfflineAudioContext` (band-limited, no aliasing).
2. **Window.** Overlapping 4-second windows with a 2-second hop. Each window is scored independently, so a half-cloned recording is caught even when its average looks ordinary.
3. **Measure** (`features.ts`):
   - noise floor / SNR (p10 vs p90 frame energy)
   - digital-zero ratio in the quietest frames
   - 99.5 % energy edge (bandwidth truncation)
   - strongest spectral cliff above 4.5 kHz (vocoder/codec wall)
   - pitch stability (f0 drift in semitones)
   - frame-to-frame spectral flux
   - energy above 6 kHz and 5–8 kHz spectral flatness (sibilance texture)
   - narrowband-telephone detection (≈3.4 kHz) — bandwidth cues are down-weighted automatically for phone recordings
4. **Score.** Each cue maps to an evidence value in `[0,1]`, weighted into a logit, then temperature-scaled (`T = 1.15`) and squashed with a sigmoid → a calibrated 0–100 % probability.
5. **Verdict bands.** `< 40 %` likely human · `40–60 %` **uncertain** (never forced) · `> 60 %` likely AI-generated · plus a distinct **partially synthetic** verdict when windows disagree.
6. **Explain.** Per-cue signed contributions are aggregated and sorted; the top cues are rendered in plain language with their measured values.

Calibration, weights and thresholds all live in one exported object: `DETECTOR_PARAMS` (`src/lib/audio/detector.ts`).

**Backend config flag** — `src/lib/audio/model.ts` holds the model registry
(`heuristic`, `lfcc-cnn`, `wav2vec2-aasist`) and resolves the configured backend from
`VITE_VSH_MODEL`. v1 bundles only `heuristic`; asking for a learned checkpoint falls back
to the bundled scorer **with an explicit note on the result** rather than silently
pretending a missing model ran.

---

## Scam-script engine

`src/lib/scam/rules.ts` holds weighted indicators across eight categories: urgency, credential theft (OTP/PIN), KYC ruse, bank impersonation, authority impersonation, intimidation, money transfer, remote-access apps, prize lures and personal-data harvesting — with phrase lists in English, Devanagari and Kannada.

- Matches are **Unicode-aware**: JavaScript's `\b` is ASCII-only, so each pattern is wrapped in `\p{L}`/`\p{N}` boundary lookarounds instead.
- Every match keeps its character offsets so the UI can highlight the exact phrase and explain it.
- The script score saturates (`100 · (1 − e^{−1.35·Σw})`) so many distinct indicators approach 100 while repeats add little.
- `combineRisk()` merges the two detectors: the stronger signal drives the meter, with a small bump when both are elevated. Thresholds: `< 35` safe, `< 65` suspicious, else high risk.

---

## Demo mode

Demo clips are **synthesized in the browser** by `src/lib/audio/synth.ts` (a formant speech synthesiser) — they are illustrations, not recordings of real people:

| Clip | Construction | Expected result |
| --- | --- | --- |
| `voice-memo` | room tone, mains hum, reverb, natural f0 drift | LIKELY HUMAN · SAFE |
| `cloned-bank-call` | digital silence, 6.2 kHz brick wall, flat loudness, locked f0 | LIKELY AI-GENERATED · HIGH RISK |
| `mixed-recording` | natural first half, cloned second half | PARTIALLY SYNTHETIC |

The transcripts attached to them are sample scripts for the rule engine.

---

## Privacy model

- **Nothing is uploaded.** Decoding, resampling, FFT, scoring and hashing all run locally; there is no analysis endpoint.
- **No account, no history server.** Results live in React state for the tab only.
- **Delete now** clears the waveform, transcript and every derived number immediately; closing the tab does the same.
- The template's Convex auth is untouched and not required for scanning.

---

## Testing & quality

```bash
bun test                              # Vitest: 48 tests
bun tsc -b --noEmit                   # strict TypeScript
bunx eslint <paths>                   # ESLint (flat config) + Prettier
```

Coverage of the core modules:

- `detector.test.ts` — FFT correctness, feature separation on both demo classes, verdict bands (40/60 inclusive), explainability ordering, silence, sub-window clips, async progress monotonicity.
- `rules.test.ts` — multilingual detection (en/hi/kn), phrase offsets, no false positives on benign text (`"whopping"`), span merging, combined-risk matrix.
- `validate.test.ts` — magic-byte routing, size limits, duration gates, formatters.
- `test/app.test.tsx` — jsdom render tests plus an end-to-end demo run (demo → pipeline → verdict + risk meter).

---

## Module API reference

The analysis layer is pure TypeScript with no DOM dependency (except `decode.ts`), so it runs in the browser and in Node tests alike.

```ts
// src/lib/audio
decodeAudioBlob(blob): Promise<DecodedAudio>       // browser: decode → 16 kHz mono
encodeWav(samples, sampleRate): Blob               // PCM → WAV (playback + demos)
sha256(bytes): Promise<string>                     // file fingerprint
validateAudioUpload(name, size, bytes)             // magic-byte + size gate
routeFile(name, bytes): RouteResult                // Check-Anything routing
extractSegmentFeatures(samples, rate)              // one window's cues
scoreSegment(features): number                     // calibrated 0–100
analyzeSignal(samples, rate): AnalysisResult       // synchronous (tests)
analyzeSignalAsync(samples, rate, onProgress)      // async with progress (UI)
computeSpectrogram(samples, rate, opts)            // log-frequency image
synthesizeClip(kind, opts): Float32Array           // demo clips

// src/lib/scam
detectLanguage(text): "en" | "hi" | "kn" | "unknown"
analyzeTranscript(text): ScamAnalysis              // score, flags, explanations
mergeSpans(flags)                                  // highlight spans
combineRisk(voiceProbability, verdict, scriptScore): RiskMeter

// src/lib/audio/model.ts
MODEL_REGISTRY                                     // heuristic | lfcc-cnn | wav2vec2-aasist
resolveModel(configured?)                          // VITE_VSH_MODEL flag + safe fallback
```

Key types: `AnalysisResult`, `SegmentResult`, `FeatureContribution` (`audio/detector`), `ScamAnalysis`, `FlaggedPhrase` (`scam/rules`), `RiskMeter` (`scam/risk`).

---

## Three-minute demo script

1. **0:00–0:20** Landing — hero, the "how it works" strip, the signal table. Point out the privacy line: *nothing is uploaded*.
2. **0:20–0:50** Click **run a scan** → drop a recording or hit **start recording** and say a few sentences.
3. **0:50–1:30** Watch the staged pipeline (validate → hash → decode → spectrogram → score → risk), then the verdict card: probability, confidence ring, risk meter.
4. **1:30–2:10** Scroll the signal view: waveform with flagged windows shaded, log-frequency spectrogram with the same windows tinted, then the per-window bar chart — highlight how one window can differ from the rest.
5. **2:10–2:40** Open **why was this flagged?** — read one cue aloud with its measured value; expand **technical details**.
6. **2:40–3:00** Paste the call's transcript (or load the `cloned-call` demo) → highlighted phrases, category explanations, combined HIGH RISK. Close with the disclaimer.

---

## Deploying

The app is a static single-page bundle — there is no analysis server to host.

```bash
bun run build     # tsc + vite build → dist/
bun run preview   # serve the production bundle locally
```

- **Vercel / Netlify / static host**: build command `bun run build`, output `dist/`.
  SPA rewrites: send every path to `/index.html` so `/scan` deep links resolve.
- **Convex**: only needed if you enable the template's optional auth (`bun convex dev`).
  The scanner itself has no backend dependency and no environment variables.
- **HTTPS**: required for microphone capture (`getUserMedia` is secure-context only).
- **CORS / rate limits**: not applicable — nothing calls out. If you later expose the
  v2 REST API, put it behind the same origin and keep rate limiting at the edge.

---

## Roadmap (v2)

Image (EXIF + Grad-CAM), video (frame sampling + audio track), text authorship, PDF reports, account-scoped history with auto-purge, batch queues, public REST API with keys and OpenAPI docs, admin usage stats, and a trained wav2vec2 / AASIST checkpoint behind the existing `scoreSegment()` interface (CPU-friendly ONNX export included in the plan).

---

## Limitations

- v1 is a **signal-heuristic baseline**, not a trained anti-spoofing network. It is strong on obvious vocoder output, digital silence and gated audio, and weaker on heavily processed human recordings (phone codecs, noise suppression, heavy compression).
- Telephone-band audio triggers the narrowband guard, which down-weights bandwidth cues and pushes the result toward **uncertain** — by design.
- Auto-transcription is not included: the scam engine runs on a transcript you paste (demo transcripts ship with the demo clips).
- Nothing here is forensic evidence.

## Stack

React 19 · Vite 7 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · Recharts · WaveSurfer.js 8 · Framer Motion · Vitest 5 · Convex (auth only)
