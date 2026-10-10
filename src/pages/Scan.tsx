import { StatusChip, TermWindow } from "@/components/Terminal";
import { EnsemblePanel, type VocalsResult } from "@/components/scan/EnsemblePanel";
import { ExplainPanel } from "@/components/scan/ExplainPanel";
import { InputPanel } from "@/components/scan/InputPanel";
import { ScamPanel } from "@/components/scan/ScamPanel";
import { SegmentTimeline } from "@/components/scan/SegmentTimeline";
import { SpectrogramPanel } from "@/components/scan/SpectrogramPanel";
import { VerdictCard } from "@/components/scan/VerdictCard";
import { WaveformPlayer, type WaveformHighlight } from "@/components/scan/WaveformPlayer";
import { WorkingPanel, type PipelineStage } from "@/components/scan/WorkingPanel";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DETECTOR_PARAMS, analyzeSignalAsync, type AnalysisResult } from "@/lib/audio/detector";
import { decodeAudioBlob, encodeWav, sha256 } from "@/lib/audio/decode";
import { applyEnsemble, type LearnedModelResult } from "@/lib/audio/ensemble";
import { blobToBase64, fetchLearnedScores, vocalsBlobFromBase64 } from "@/lib/audio/learned";
import { detectMusic, type MusicReport } from "@/lib/audio/music";
import { computeSpectrogram, type Spectrogram } from "@/lib/audio/spectrogram";
import { synthesizeClip } from "@/lib/audio/synth";
import { formatBytes, formatDuration, validateAudioUpload } from "@/lib/audio/validate";
import { demoClipById } from "@/lib/demo/clips";
import { combineRisk } from "@/lib/scam/risk";
import { analyzeTranscript, type ScamAnalysis } from "@/lib/scam/rules";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

type Stage = "input" | "working" | "result";

interface CompletedScan {
  key: number;
  fileName: string;
  fileSize: number;
  format: string;
  hash?: string;
  audioBlob: Blob;
  samples: Float32Array;
  durationSec: number;
  /** Final (possibly ensemble) analysis shown everywhere. */
  analysis: AnalysisResult;
  /** On-device heuristic score alone, shown next to the learned model. */
  heuristicProbability: number;
  learned: LearnedModelResult | null;
  music: MusicReport | null;
  vocals: VocalsResult | null;
  analysisMode: "ensemble" | "private" | "heuristic";
  spectrogram: Spectrogram;
  transcript: string;
  transcriptNote?: string;
  transcriptLanguage?: "en" | "hi";
  transcriptSource: string;
}

const STAGE_TEMPLATE: PipelineStage[] = [
  { id: "validate", label: "verify container (magic bytes)", status: "pending" },
  { id: "hash", label: "sha-256 fingerprint", status: "pending" },
  { id: "decode", label: "decode + resample to 16 kHz mono", status: "pending" },
  { id: "spectrogram", label: "build log-frequency spectrogram", status: "pending" },
  { id: "score", label: "score sliding 4-second windows", status: "pending" },
  { id: "music", label: "check for music / mixed content", status: "pending" },
  { id: "model", label: "learned anti-spoofing model (server)", status: "pending" },
  { id: "risk", label: "calibrate probability + risk meter", status: "pending" },
];

const PRIVATE_MODE_KEY = "vsh-private-mode";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setStageStatus(
  stages: PipelineStage[],
  id: string,
  status: PipelineStage["status"],
): PipelineStage[] {
  return stages.map((stage) => (stage.id === id ? { ...stage, status } : stage));
}

export default function Scan() {
  const [searchParams] = useSearchParams();
  const [stage, setStage] = useState<Stage>("input");
  const [stages, setStages] = useState<PipelineStage[]>(STAGE_TEMPLATE);
  const [progress, setProgress] = useState(0);
  const [workingFile, setWorkingFile] = useState("");
  const [scan, setScan] = useState<CompletedScan | null>(null);
  const [scam, setScam] = useState<ScamAnalysis>(() => analyzeTranscript(""));
  const [error, setError] = useState<string | null>(null);
  const [privateMode, setPrivateMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PRIVATE_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const counter = useRef(0);

  const scoreAudio = useAction(api.voiceshield.scoreAudio);
  const separateAudio = useAction(api.voiceshield.separateAudio);

  const togglePrivateMode = useCallback(() => {
    setPrivateMode((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(PRIVATE_MODE_KEY, next ? "1" : "0");
      } catch {
        // Storage can be blocked; the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  const runPipeline = useCallback(
    async (input: {
      name: string;
      size: number;
      bytes: Uint8Array;
      blob: Blob;
      format: string;
      samples?: Float32Array;
      transcript: string;
      transcriptNote?: string;
      transcriptLanguage?: "en" | "hi";
      transcriptSource: string;
    }) => {
      counter.current += 1;
      const key = counter.current;
      setWorkingFile(input.name);
      setError(null);
      setProgress(0.02);
      setStages(STAGE_TEMPLATE);
      setStage("working");

      try {
        // 1. validate
        let current = setStageStatus(STAGE_TEMPLATE, "validate", "active");
        setStages(current);
        const validation = validateAudioUpload(input.name, input.size, input.bytes);
        await tick();
        if (!validation.ok) throw new Error(validation.error);
        current = setStageStatus(current, "validate", "done");
        setStages(current);
        setProgress(0.08);

        // 2. hash
        current = setStageStatus(current, "hash", "active");
        setStages(current);
        const hash = await sha256(input.bytes);
        current = setStageStatus(current, "hash", "done");
        setStages(current);
        setProgress(0.16);

        // 3. decode
        current = setStageStatus(current, "decode", "active");
        setStages(current);
        await tick();
        let samples = input.samples;
        let durationSec = 0;
        if (!samples) {
          const decoded = await decodeAudioBlob(input.blob);
          samples = decoded.samples;
          durationSec = decoded.durationSec;
        } else {
          durationSec = samples.length / 16000;
        }
        const audioBlob = encodeWav(samples, 16000);
        current = setStageStatus(current, "decode", "done");
        setStages(current);
        setProgress(0.3);

        // 4. spectrogram
        current = setStageStatus(current, "spectrogram", "active");
        setStages(current);
        await tick();
        const spectrogram = computeSpectrogram(samples, 16000, { rows: 220 });
        current = setStageStatus(current, "spectrogram", "done");
        setStages(current);
        setProgress(0.45);

        // 5. score windows
        current = setStageStatus(current, "score", "active");
        setStages(current);
        const heuristicAnalysis = await analyzeSignalAsync(samples, 16000, (fraction) => {
          setProgress(0.45 + fraction * 0.35);
        });
        current = setStageStatus(current, "score", "done");
        setStages(current);
        setProgress(0.8);

        // 6. music detection (+ vocal separation on the server when it is a song)
        current = setStageStatus(current, "music", "active");
        setStages(current);
        await tick();
        const music = detectMusic(samples, 16000);
        let vocals: VocalsResult | null = null;
        if (music.isMusic) {
          if (privateMode) {
            vocals = {
              probability: heuristicAnalysis.probability,
              verdict: heuristicAnalysis.verdict,
              available: false,
              note: "Vocal separation needs the server; private mode keeps the whole file on-device, so the full mix was scored as-is.",
            };
          } else {
            try {
              const separation = await separateAudio({
                audioBase64: await blobToBase64(audioBlob),
              });
              if (separation.ok) {
                const vocalsBlob = vocalsBlobFromBase64(separation.vocalsBase64);
                const decodedVocals = await decodeAudioBlob(vocalsBlob);
                const vocalsAnalysis = await analyzeSignalAsync(decodedVocals.samples, 16000);
                vocals = {
                  probability: vocalsAnalysis.probability,
                  verdict: vocalsAnalysis.verdict,
                  available: true,
                };
              } else {
                vocals = {
                  probability: heuristicAnalysis.probability,
                  verdict: heuristicAnalysis.verdict,
                  available: false,
                  note: separation.reason,
                };
              }
            } catch {
              vocals = {
                probability: heuristicAnalysis.probability,
                verdict: heuristicAnalysis.verdict,
                available: false,
                note: "Vocal separation failed; the full mix was scored as-is.",
              };
            }
          }
        }
        current = setStageStatus(current, "music", "done");
        setStages(current);
        setProgress(0.85);

        // 7. learned anti-spoofing model (server) → weighted ensemble
        current = setStageStatus(current, "model", "active");
        setStages(current);
        let learned: LearnedModelResult | null = null;
        let analysis = heuristicAnalysis;
        let analysisMode: CompletedScan["analysisMode"] = "heuristic";
        if (privateMode) {
          analysisMode = "private";
        } else {
          learned = await fetchLearnedScores(samples, 16000, scoreAudio);
          analysis = applyEnsemble(heuristicAnalysis, learned);
          analysisMode = learned.available ? "ensemble" : "heuristic";
        }
        current = setStageStatus(current, "model", "done");
        setStages(current);
        setProgress(0.92);

        // 8. transcript + risk
        current = setStageStatus(current, "risk", "active");
        setStages(current);
        const scamResult = analyzeTranscript(input.transcript);
        await tick();
        current = setStageStatus(current, "risk", "done");
        setStages(current);
        setProgress(1);

        const nextScan: CompletedScan = {
          key,
          fileName: input.name,
          fileSize: input.size,
          format: input.format,
          hash,
          audioBlob,
          samples,
          durationSec,
          analysis,
          heuristicProbability: heuristicAnalysis.probability,
          learned,
          music,
          vocals,
          analysisMode,
          spectrogram,
          transcript: input.transcript,
          transcriptNote: input.transcriptNote,
          transcriptLanguage: input.transcriptLanguage,
          transcriptSource: input.transcriptSource,
        };
        setScan(nextScan);
        setScam(scamResult);
        setStage("result");
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.success("Analysis complete", {
          description: `${analysis.probability.toFixed(1)}% synthetic · ${analysis.segments.length} windows scored${learned?.available ? ` · ${learned.modelId}` : " · heuristic only"}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong while analysing.";
        setError(message);
        setStage("input");
        toast.error("Analysis stopped", { description: message });
      }
    },
    [privateMode, scoreAudio, separateAudio],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const validation = validateAudioUpload(file.name, file.size, bytes);
      if (!validation.ok) {
        toast.error("Cannot analyse that file", { description: validation.error });
        return;
      }
      await runPipeline({
        name: file.name,
        size: file.size,
        bytes,
        blob: file,
        format: validation.format.toUpperCase(),
        transcript: "",
        transcriptSource: "",
      });
    },
    [runPipeline],
  );

  const handleDemo = useCallback(
    async (id: string) => {
      const clip = demoClipById(id);
      if (!clip) return;
      const samples = synthesizeClip(clip.synthesis, { seconds: clip.seconds });
      const wav = encodeWav(samples, 16000);
      const file = new File([wav], clip.fileName, { type: "audio/wav" });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await runPipeline({
        name: clip.fileName,
        size: file.size,
        bytes,
        blob: file,
        format: "WAV",
        samples,
        transcript: clip.transcript,
        transcriptNote: clip.transcriptNote,
        transcriptLanguage: clip.transcriptLanguage,
        transcriptSource: `demo:${clip.id}`,
      });
    },
    [runPipeline],
  );

  // Deep link: /scan?demo=cloned-call loads and runs that demo automatically.
  useEffect(() => {
    const demoId = searchParams.get("demo");
    if (!demoId || !demoClipById(demoId)) return;
    // Deferred so the effect body itself stays free of state updates.
    const timer = window.setTimeout(() => void handleDemo(demoId), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, handleDemo]);

  const reset = useCallback(() => {
    setScan(null);
    setScam(analyzeTranscript(""));
    setError(null);
    setProgress(0);
    setStages(STAGE_TEMPLATE);
    setStage("input");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const risk = useMemo(
    () =>
      scan
        ? combineRisk(scan.analysis.probability, scan.analysis.verdict, scam.score)
        : null,
    [scan, scam],
  );

  const highlights = useMemo<WaveformHighlight[]>(() => {
    if (!scan) return [];
    return scan.analysis.segments
      .filter((segment) => !segment.silent && segment.probability >= DETECTOR_PARAMS.uncertainLow)
      .map((segment) => ({
        start: segment.startSec,
        end: Math.min(segment.endSec, scan.durationSec),
        probability: segment.probability,
      }));
  }, [scan]);

  const flaggedRegions = useMemo<Array<[number, number]>>(() => {
    if (!scan) return [];
    return scan.analysis.segments
      .filter((segment) => !segment.silent && segment.probability >= DETECTOR_PARAMS.flagSegment)
      .map(
        (segment) =>
          [segment.startSec, Math.min(segment.endSec, scan.durationSec)] as [number, number],
      );
  }, [scan]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              home
            </Link>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
              check anything
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              drop a file, record a call, or load a demo — v1 analyses audio.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={privateMode ? "warn" : "ok"}>
              {privateMode ? "private mode · on-device" : "ensemble · server model"}
            </StatusChip>
            <button
              type="button"
              onClick={togglePrivateMode}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 rounded border px-2 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors"
            >
              {privateMode ? "use learned model" : "private mode"}
            </button>
            <StatusChip tone="muted">25 mb max</StatusChip>
            <StatusChip tone="muted">en · hi · kn</StatusChip>
          </div>
        </div>

        {stage === "input" ? (
          <div className="mx-auto max-w-3xl">
            {error ? (
              <div className="border-risk/40 bg-risk-surface mb-4 flex items-start gap-3 rounded-md border p-3 text-sm">
                <ShieldAlert className="text-risk mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            ) : null}
            <InputPanel onPick={handleFile} onDemo={handleDemo} />
          </div>
        ) : null}

        {stage === "working" ? (
          <div className="mx-auto max-w-2xl">
            <WorkingPanel fileName={workingFile} stages={stages} progress={progress} />
          </div>
        ) : null}

        {stage === "result" && scan && risk ? (
          <div className="space-y-6">
            <VerdictCard
              result={scan.analysis}
              risk={risk}
              fileName={scan.fileName}
              fileSize={scan.fileSize}
              format={scan.format}
              hash={scan.hash}
              onReset={reset}
            />

            <TermWindow title="signal view" right={<span className="text-muted-foreground text-[10px]">{formatDuration(scan.durationSec)} · 16 kHz</span>}>
              <div className="space-y-6">
                <WaveformPlayer
                  key={`wave-${scan.key}`}
                  blob={scan.audioBlob}
                  durationSec={scan.durationSec}
                  highlights={highlights}
                  fileName={scan.fileName}
                />
                <SpectrogramPanel
                  key={`spec-${scan.key}`}
                  samples={scan.samples}
                  sampleRate={16000}
                  durationSec={scan.durationSec}
                  flagged={flaggedRegions}
                />
              </div>
            </TermWindow>

            <TermWindow
              title="models & music"
              right={
                <span className="text-muted-foreground text-[10px]">
                  {scan.analysisMode === "private"
                    ? "private mode — nothing left this tab"
                    : scan.analysisMode === "ensemble"
                      ? "learned model + heuristic"
                      : "on-device heuristic only"}
                </span>
              }
            >
              <EnsemblePanel
                result={scan.analysis}
                heuristicProbability={scan.heuristicProbability}
                learned={scan.learned}
                music={scan.music}
                vocals={scan.vocals}
              />
            </TermWindow>

            <TermWindow title="window timeline">
              <SegmentTimeline segments={scan.analysis.segments} durationSec={scan.durationSec} />
            </TermWindow>

            <div className="grid gap-6 lg:grid-cols-2">
              <ExplainPanel key={`explain-${scan.key}`} result={scan.analysis} />
              <ScamPanel
                key={`scam-${scan.key}`}
                initialTranscript={scan.transcript}
                languageHint={scan.transcriptLanguage}
                note={scan.transcriptNote}
                analysis={scam}
                onAnalysisChange={setScam}
              />
            </div>

            <div className="border-border bg-card rounded-lg border p-4">
              <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                <ShieldAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="text-foreground font-semibold">Disclaimer:</span> this result is a
                  probability, not proof. It cannot establish that a recording is authentic or that a
                  caller is fraudulent. Nothing here is admissible evidence — verify independently
                  through official channels before transferring money or sharing credentials.
                  {" "}File size {formatBytes(scan.fileSize)} ·{" "}
                  {scan.analysisMode === "private"
                    ? "analysed entirely in this tab — nothing was uploaded"
                    : "the heuristic ran in this tab; the first 3 minutes were also sent to the deployed model for the learned score"}
                  {" "}· delete it any time with the button above.
                </span>
              </p>
            </div>
          </div>
        ) : null}
      </main>

      <SiteFooter />
    </div>
  );
}
