# Model card — VoiceShield AI v1

| | |
| --- | --- |
| **Model id** | `vsa-heuristic-0.1` |
| **Type** | Signal-feature baseline (deterministic, non-learned) + temperature-scaled logistic head |
| **Task** | Binary: synthetic / cloned speech vs. human recording, per 4 s window and per clip |
| **Sample rate** | 16 kHz mono (band-limited resampling via `OfflineAudioContext`) |
| **Inputs** | 7 measured cues per window (noise floor, digital-zero ratio, bandwidth edge, spectral cliff, pitch stability, spectral flux, sibilance texture) |
| **Output** | Calibrated probability 0–100 %, verdict band, confidence, per-cue contributions |
| **Runtime** | Browser only; ~50–400 ms for a 60 s clip on a laptop CPU |

## Intended use

- Tell a member of the public whether a voice note or call recording shows signs of
  synthesis or cloning, and whether the words match a known scam script.
- Provide an interpretable "why" next to every score.

## Out-of-scope use

- Forensic or legal evidence of any kind.
- Deciding whether a specific person is lying or fraudulent.
- Automatic blocking, demonetisation or any other action taken without a human in the loop.

## Decision policy

| Probability | Verdict |
| --- | --- |
| < 40 % | **Likely human** |
| 40–60 % | **Uncertain** — never forced into a binary call |
| > 60 % | **Likely AI-generated** |
| windows disagree (gap ≥ 25 pts) | **Partially synthetic** |

Confidence is `|p − 50| / 40`, reported as low / medium / high. A partially-synthetic
verdict reports confidence from the separation between windows rather than from the mean.

## Calibration

Raw window logits are divided by a temperature `T = 1.15` before the sigmoid
(`DETECTOR_PARAMS.temperature`). The value is a placeholder calibrated by inspection on
the bundled demo distribution; **re-fit it on a held-out validation set** (ECE /
reliability diagram) as soon as a trained checkpoint exists, and record the new value
here.

## Known limitations

1. **Not a trained anti-spoofing model.** The cues are physically motivated but hand-
   weighted. They are strongest against vocoder bandwidth walls, digital silence and
   noise-gated output; they are weaker against heavily post-processed human speech.
2. **Telephone and codec confounds.** Narrowband (≈3.4 kHz) audio is detected and
   bandwidth cues are automatically down-weighted (`narrowband` flag), which usually
   pushes the result into the uncertain band rather than producing a false accusation.
3. **Noise-suppression confound.** Aggressive denoising or heavy lossy compression on
   real speech can raise the SNR and digital-silence cues, i.e. produce false positives.
4. **Very short clips.** Below the 4 s window, segment statistics are unstable; the UI
   says so explicitly.
5. **Language.** The acoustic model is language-agnostic; the scam-script rule engine
   covers English, Hindi and Kannada phrase lists only.
6. **Transcripts.** The scam engine reads a pasted transcript; auto-transcription is not
   part of v1, so a wrong transcript yields a wrong script score.

## Evaluation plan (before v2)

- Train the CNN / wav2vec2 head on **ASVspoof 2019**, **WaveFake** and **In-the-Wild**.
- Report Accuracy, Precision, Recall, F1, ROC-AUC, EER and a confusion matrix
  (`ml/evaluate.py` in the v2 roadmap).
- **Cross-dataset evaluation**: train on one corpus, test on another, to measure
  generalisation rather than corpus-specific artifacts.
- Augmentations during training: additive noise, MP3 / telephone-codec simulation,
  resampling, gain variation.
- Publish the reliability diagram and re-fit `temperature`.

## Training-data statement

**No user upload is ever used for training.** All inference happens client-side and the
tab-local result is discarded when it is deleted or closed.

## Changelog

- `vsa-heuristic-0.1` — initial signal baseline, seven cues, temperature 1.15,
  narrowband guard, partial-clone verdict.
