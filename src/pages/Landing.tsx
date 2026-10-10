import { OutputLine, PromptLine, SectionLabel, StatusChip, TermWindow } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { DEMO_CLIPS } from "@/lib/demo/clips";
import { ArrowRight, Fingerprint, Lock, ScanLine, Waves } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router";

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.45, ease: "easeOut" as const },
};

const STEPS = [
  {
    n: "01",
    title: "Drop or record",
    body: "WAV, MP3, M4A, OGG or FLAC up to 25 MB — or hit the mic and record the call live. Files are read from disk, never uploaded.",
    tone: "ok" as const,
  },
  {
    n: "02",
    title: "Slide a 4s window",
    body: "The clip is resampled to 16 kHz and scanned with overlapping 4-second windows, so a recording that is only half cloned still gets caught.",
    tone: "muted" as const,
  },
  {
    n: "03",
    title: "Score the artifacts",
    body: "Noise floor, digital silence, bandwidth walls, pitch drift and sibilance texture are weighted into one calibrated probability.",
    tone: "warn" as const,
  },
  {
    n: "04",
    title: "Read the script",
    body: "Add a transcript and the rule engine flags urgency, OTP requests, impersonation, threats, transfers and remote-access apps in EN / हिन्दी / ಕನ್ನಡ.",
    tone: "risk" as const,
  },
];

const SIGNALS = [
  {
    name: "room tone / noise floor",
    human: "quiet passages sit 30–45 dB below speech",
    synth: "pauses fall to digital silence, 70 dB+ below",
  },
  {
    name: "digital silence",
    human: "dither and hiss never fully disappear",
    synth: "runs of exactly-zero samples between phrases",
  },
  {
    name: "truncated bandwidth",
    human: "sibilance reaches 7–8 kHz and beyond",
    synth: "99.5% of energy stops abruptly below the band",
  },
  {
    name: "hard spectral cliff",
    human: "energy rolls off gently",
    synth: "a 20 dB+ wall at a vocoder or codec edge",
  },
  {
    name: "pitch stability",
    human: "intonation drifts across a sentence",
    synth: "f0 locks to a single value for seconds",
  },
  {
    name: "sibilance texture",
    human: "shaped, noisy 5–8 kHz band",
    synth: "hollow or missing high band after gating",
  },
];

const CATEGORIES = [
  { label: "urgency", hint: "“blocked within 24 hours”", tone: "warn" as const },
  { label: "OTP / PIN", hint: "“share the code we just sent”", tone: "risk" as const },
  { label: "impersonation", hint: "bank, police, courier, tech support", tone: "risk" as const },
  { label: "threats", hint: "“a case will be filed today”", tone: "risk" as const },
  { label: "money transfer", hint: "UPI, GPay, gift cards, crypto", tone: "warn" as const },
  { label: "remote access", hint: "“install AnyDesk so I can help”", tone: "risk" as const },
];

const FORMATS = [
  ["wav", "WAVE", "25 MB", "supported"],
  ["mp3", "MPEG audio", "25 MB", "supported"],
  ["m4a", "MPEG-4 audio", "25 MB", "supported"],
  ["ogg", "Ogg Vorbis/Opus", "25 MB", "supported"],
  ["flac", "FLAC lossless", "25 MB", "supported"],
  ["webm", "WebM (recorder)", "25 MB", "supported"],
  ["mp4 / mov / webm", "video", "100 MB", "v2"],
  ["png / jpg / webp", "image", "10 MB", "v2"],
  ["plain text", "text", "—", "v2"],
];

const FAQ = [
  {
    q: "How accurate is this, honestly?",
    a: "It is a calibrated baseline, not a forensic tool. Version 1 uses signal-level cues (noise floor, bandwidth, pitch stability, sibilance texture) instead of a trained neural anti-spoofing model, so it is strong on obvious vocoder and gated output and weaker on heavily processed human recordings. Every result shows a confidence level and an explicit 40–60% uncertain band so the tool never pretends to know what it does not.",
  },
  {
    q: "Does my audio get uploaded anywhere?",
    a: "No. Decoding, resampling, feature extraction and scoring all happen in your browser tab. Nothing is sent to a server, nothing is stored after you close the tab, and no recording is ever used for training. You can wipe a result instantly with Delete analysis.",
  },
  {
    q: "What does “partially synthetic” mean?",
    a: "Some recordings are spliced: a real call with a cloned sentence inserted, or a voice note where only half was generated. The 4-second sliding window scores each slice independently, so a clip can be reported as partially synthetic even when its overall average looks ordinary.",
  },
  {
    q: "Why does the verdict sometimes say UNCERTAIN?",
    a: "Between 40% and 60% the evidence genuinely does not point either way — usually telephone-band audio, heavy compression, or very short clips. Reporting “uncertain” is the honest answer and keeps the score from being misread as a binary judgement.",
  },
  {
    q: "Can I use this as proof of a scam?",
    a: "No. Detection is probabilistic. Treat a HIGH RISK result as a reason to stop, hang up and verify through an official number — never as evidence in a dispute. Courts and banks need independent verification.",
  },
  {
    q: "Why is version 1 audio only?",
    a: "Voice cloning is the scam vector hitting ordinary people right now, so v1 ships a deep, tested audio path instead of shallow support for everything. Image, video and text detectors are routed on the Check-Anything page with a clear v2 notice.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* ───────────────────────── hero ───────────────────────── */}
      <section className="term-grid border-border relative border-b">
        <div className="from-background/0 via-background/80 to-background absolute inset-0 bg-gradient-to-b" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 pt-16 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-24 lg:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone="ok">v1 · voice clones</StatusChip>
              <StatusChip tone="muted">en / हिन्दी / ಕನ್ನಡ</StatusChip>
              <StatusChip tone="muted">runs on-device</StatusChip>
            </div>

            <h1 className="mt-6 text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Is that voice
              <br />
              <span className="text-ok">really</span> them?
              <span className="blink text-ok ml-1 inline-block">▌</span>
            </h1>

            <p className="text-muted-foreground mt-6 max-w-xl text-sm leading-6 sm:text-base">
              VoiceShield AI checks whether a voice recording was generated or cloned, and whether
              the words follow a scam script. Drop a call recording, record live, or run a demo —
              the analysis never leaves your browser.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="cursor-pointer gap-2 font-bold tracking-wide uppercase">
                <Link to="/scan">
                  run a scan
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="cursor-pointer gap-2 uppercase">
                <a href="#how">how it works</a>
              </Button>
            </div>

            <dl className="text-muted-foreground mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
              {[
                ["25 MB", "max upload"],
                ["4 s", "window"],
                ["0", "files uploaded"],
                ["< 2 s", "typical run"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-foreground text-xl font-bold">{value}</dt>
                  <dd className="mono-cap mt-1">{label}</dd>
                </div>
              ))}
            </dl>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
          >
            <TermWindow title="voiceshield — session 0x41f" right={<StatusChip tone="ok">live</StatusChip>}>
              <PromptLine>voxshield --scan cloned-bank-call.wav</PromptLine>
              <div className="mt-3 space-y-2">
                <OutputLine label="ok">decoded 16 kHz mono · 12.0 s</OutputLine>
                <OutputLine label="ok">6 sliding windows · 4.0 s each</OutputLine>
                <OutputLine label="warn" tone="warn">
                  bandwidth wall at 6.2 kHz
                </OutputLine>
                <OutputLine label="warn" tone="warn">
                  digital silence in every pause
                </OutputLine>
                <OutputLine label="risk" tone="risk">
                  verdict: LIKELY AI-GENERATED · 86%
                </OutputLine>
                <OutputLine label="risk" tone="risk">
                  script: OTP + AnyDesk + urgency → HIGH RISK
                </OutputLine>
              </div>
              <div className="border-border mt-4 border-t border-dashed pt-3">
                <PromptLine className="opacity-70">
                  voxshield --scan <span className="blink">▌</span>
                </PromptLine>
              </div>
            </TermWindow>

            <p className="text-muted-foreground mt-3 text-[11px] leading-5">
              Illustrative output. Real results include the score, per-window timeline, waveform
              highlights and plain-language reasoning.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ───────────────────────── demo strip ───────────────────────── */}
      <section className="border-border border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <SectionLabel index="00">judge it yourself</SectionLabel>
            <p className="text-muted-foreground text-xs">
              three synthetic clips · one natural, one cloned, one half-and-half
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {DEMOS.map((demo, i) => (
              <motion.div
                key={demo.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                className="border-border hover:border-ok/60 group flex flex-col rounded-lg border bg-card p-4 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground mono-cap">{demo.tag}</span>
                  <StatusChip tone={demo.tone}>{demo.expected}</StatusChip>
                </div>
                <p className="mt-3 text-sm font-bold tracking-tight">{demo.title}</p>
                <p className="text-muted-foreground mt-1.5 flex-1 text-xs leading-5">{demo.blurb}</p>
                <Link
                  to={`/scan?demo=${demo.id}`}
                  className="text-foreground group-hover:text-ok mt-4 inline-flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase transition-colors"
                >
                  load demo
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── how it works ───────────────────────── */}
      <section id="how" className="border-border scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionLabel index="01">how it works</SectionLabel>
          <h2 className="mt-4 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            Four seconds at a time, entirely on your machine.
          </h2>

          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <motion.div
                key={step.n}
                {...reveal}
                className="bg-card flex flex-col gap-3 p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-ok text-xl font-bold">{step.n}</span>
                  <StatusChip tone={step.tone}>step</StatusChip>
                </div>
                <h3 className="text-sm font-bold tracking-tight">{step.title}</h3>
                <p className="text-muted-foreground text-xs leading-5">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── signals ───────────────────────── */}
      <section id="signals" className="border-border scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionLabel index="02">the signals</SectionLabel>
          <h2 className="mt-4 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            What separates a microphone from a vocoder.
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
            Every result lists the exact measurements behind the score, with the direction each one
            pushed the verdict. No black box, no “trust us”.
          </p>

          <div className="mt-8 overflow-hidden rounded-lg border">
            <div className="bg-shell text-muted-foreground hidden grid-cols-[1.1fr_1fr_1fr] gap-4 px-4 py-2.5 text-[11px] tracking-[0.14em] uppercase md:grid">
              <span>signal</span>
              <span>human recording</span>
              <span>generated / cloned</span>
            </div>
            <div className="divide-border divide-y">
              {SIGNALS.map((signal, i) => (
                <motion.div
                  key={signal.name}
                  {...reveal}
                  transition={{ ...reveal.transition, delay: i * 0.04 }}
                  className="hover:bg-card grid gap-2 px-4 py-3.5 text-sm transition-colors md:grid-cols-[1.1fr_1fr_1fr] md:gap-4"
                >
                  <span className="font-bold tracking-tight">{signal.name}</span>
                  <span className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                    <span className="text-ok mt-0.5">▸</span>
                    {signal.human}
                  </span>
                  <span className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                    <span className="text-risk mt-0.5">▸</span>
                    {signal.synth}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Waves className="text-ok size-4" aria-hidden />
                scam-script rules
              </h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <span
                    key={category.label}
                    className="border-border bg-card flex items-baseline gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    <StatusChip tone={category.tone}>{category.label}</StatusChip>
                    <span className="text-muted-foreground">{category.hint}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Fingerprint className="text-ok size-4" aria-hidden />
                combined risk meter
              </h3>
              <div className="border-border mt-4 space-y-2 rounded-md border bg-card p-4 text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-ok">■</span>
                  <span className="text-muted-foreground">
                    SAFE — natural voice, no scam indicators
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-warn">■</span>
                  <span className="text-muted-foreground">
                    SUSPICIOUS — one signal elevated, or inconclusive
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-risk">■</span>
                  <span className="text-muted-foreground">
                    HIGH RISK — cloned voice, scam script, or both
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── formats ───────────────────────── */}
      <section id="formats" className="border-border scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <SectionLabel index="03">supported formats</SectionLabel>
              <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                Drop what you have.
              </h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Files are checked by magic bytes, not by their extension — a renamed image is
                rejected before it ever reaches the decoder. Anything that is not audio is routed to
                its future module with a clear v2 notice.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1.5">
                  <ScanLine className="size-3.5" aria-hidden /> check anything
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <Lock className="size-3.5" aria-hidden /> on-device only
                </Badge>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="text-muted-foreground bg-shell text-left text-[11px] tracking-[0.14em] uppercase">
                    <th className="px-3 py-2.5 font-medium">input</th>
                    <th className="px-3 py-2.5 font-medium">container</th>
                    <th className="px-3 py-2.5 font-medium">limit</th>
                    <th className="px-3 py-2.5 text-right font-medium">status</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {FORMATS.map(([input, container, limit, status]) => (
                    <tr key={input} className="hover:bg-card transition-colors">
                      <td className="px-3 py-2.5 font-medium">{input}</td>
                      <td className="text-muted-foreground px-3 py-2.5 text-xs">{container}</td>
                      <td className="text-muted-foreground px-3 py-2.5 text-xs">{limit}</td>
                      <td className="px-3 py-2.5 text-right">
                        <StatusChip tone={status === "supported" ? "ok" : "muted"}>
                          {status}
                        </StatusChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── privacy ───────────────────────── */}
      <section className="border-border border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "Nothing is uploaded",
                body: "Decode, resample, FFT and scoring all run in this tab. There is no server-side copy to breach, subpoena or train on.",
              },
              {
                icon: Fingerprint,
                title: "No account, no tracking",
                body: "Version 1 is built for the public: no sign-up wall, no analytics on your audio, no history stored anywhere but this tab.",
              },
              {
                icon: ScanLine,
                title: "Delete it yourself",
                body: "One click clears the waveform, the transcript and every derived number from memory. Closing the tab does the same.",
              },
            ].map((item) => (
              <motion.div key={item.title} {...reveal} className="border-border border-l-2 pl-4">
                <item.icon className="text-ok size-5" aria-hidden />
                <h3 className="mt-3 text-sm font-bold tracking-tight">{item.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-xs leading-5">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── faq ───────────────────────── */}
      <section id="faq" className="border-border scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <SectionLabel index="04">faq</SectionLabel>
          <h2 className="mt-4 mb-6 text-2xl font-bold tracking-tight sm:text-3xl">
            Straight answers.
          </h2>

          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i}`}>
                <AccordionTrigger className="text-sm hover:no-underline">
                  <span className="flex items-start gap-3 text-left">
                    <span className="text-ok shrink-0 font-bold">{String(i + 1).padStart(2, "0")}</span>
                    <span>{item.q}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-6">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ───────────────────────── cta ───────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="border-border bg-card rounded-lg border p-6 sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <SectionLabel index="05">ready</SectionLabel>
              <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                Check that recording before you act on it.
              </h2>
              <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
                Upload a file, record live, or load a demo clip and watch the timeline light up.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button asChild size="lg" className="cursor-pointer gap-2 font-bold uppercase">
                <Link to="/scan">
                  open the scanner
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="cursor-pointer uppercase">
                <Link to="/scan?demo=cloned-call">run the cloned-call demo</Link>
              </Button>
            </div>
          </div>

          <p className="border-border text-muted-foreground mt-8 border-t border-dashed pt-4 text-xs leading-5">
            Disclaimer: VoiceShield AI produces probabilities, not proof. A “LIKELY HUMAN” result
            does not guarantee authenticity, and a “HIGH RISK” result does not prove deception.
            Verify independently before transferring money or sharing credentials.
          </p>
        </div>
      </section>
    </div>
  );
}

const DEMOS = DEMO_CLIPS.map((clip) => ({
  id: clip.id,
  title: clip.title,
  blurb: clip.blurb,
  expected: clip.expected === "ai" ? "cloned" : clip.expected,
  tag: clip.transcriptLanguage === "hi" ? "हिन्दी script" : "en script",
  tone: (clip.expected === "real" ? "ok" : clip.expected === "ai" ? "risk" : "warn") as
    | "ok"
    | "warn"
    | "risk",
}));
