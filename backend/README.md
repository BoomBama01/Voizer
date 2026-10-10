# VoiceShield backend service

A small FastAPI service that gives the web app three things it cannot do on
its own:

| Endpoint | What it does | Enabled by |
| --- | --- | --- |
| `POST /v1/score` | Per-window anti-spoofing scores from a pretrained wav2vec2 checkpoint | always |
| `POST /v1/separate` | Demucs vocal separation (music mode: score the stem and the mix) | `VSA_ENABLE_SEPARATION=1` |
| `POST /v1/clone` | Chatterbox zero-shot voice cloning for `/clone` | `VSA_ENABLE_TTS=1` |
| `GET /health` | Configuration summary, no secrets | always |

The web app reaches it through Convex actions (`src/convex/voiceshield.ts`),
so the service URL and key live only in the Convex environment.

## Model choice (checked before shipping)

The default checkpoint is **[`MelodyMachine/Deepfake-audio-detection-V2`](https://huggingface.co/MelodyMachine/Deepfake-audio-detection-V2)**
because it is the combination that actually works on a small CPU service:
Wav2Vec2 sequence classifier, 94.6M parameters, **Apache-2.0**, weights
(`model.safetensors`, 378 MB) and `preprocessor_config.json` are directly
downloadable, and it loads with plain `transformers` — no custom loader.

Read its card before you rely on the numbers: the **99.73% accuracy** on it is
self-reported on its own `audiofolder` evaluation set, **not** ASVspoof or
In-the-Wild. Treat it as an unverified benchmark and run `scripts/eval.mjs`
against your own traffic.

Alternatives considered (all facts verified on their model cards):

| Repo | License | Trained on | Reported | Why not the default |
| --- | --- | --- | --- | --- |
| [`caa-speech-detection-asvspoof2019/rawnet2`](https://huggingface.co/caa-speech-detection-asvspoof2019/rawnet2) | MIT | ASVspoof 2019 LA | 15.09% EER eval, **38.57% EER In-the-Wild** | Real benchmark numbers, but needs a custom PyTorch loader (not `transformers`) |
| [`caa-speech-detection-asvspoof2019/lcnn-v7-cqt`](https://huggingface.co/caa-speech-detection-asvspoof2019/lcnn-v7-cqt) | MIT | ASVspoof 2019 LA | 3.26% EER eval, 33.41% In-the-Wild | 3.6 MB and CPU-cheap, but custom CQT preprocessing + loader; weak outside ASVspoof |
| [`lab260/AASIST3`](https://huggingface.co/lab260/AASIST3) | **CC BY-NC-ND 4.0** | ASVspoof 19/21 + In-the-Wild | EERs on all three | Non-commercial, no derivatives — not usable for this product |
| [`Om-Parab/distilhubert-finetuned-audio-deepfake-in-the-wild`](https://huggingface.co/Om-Parab/distilhubert-finetuned-audio-deepfake-in-the-wild) | not stated | not stated | not stated | 23.7M params and interesting, but the card verifies nothing |

Swap the checkpoint with `VSA_MODEL_ID=<org/repo>` (+ `VSA_MODEL_LICENSE`).
The service auto-detects the "synthetic" label from `id2label`; if a model
uses unusual label names, adjust `_synthetic_probability()`.

## Run it

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # add --extra-index-url https://download.pytorch.org/whl/cpu for CPU-only torch
export VSA_API_KEY="some-long-random-string"
uvicorn app:app --host 0.0.0.0 --port 8000
```

Deploy options:

- **Hugging Face Space (Docker SDK)** — push this folder as the Space repo
  (Dockerfile is included), set `VSA_API_KEY` (+ `VSA_MODEL_ID`) in the
  Space secrets. CPU Spaces work; first request is slow while the checkpoint
  downloads to the model cache.
- **Render / Fly / Railway** — `docker build -t vsh-backend . && docker run -e
  VSA_API_KEY=... -p 8000:8000 vsh-backend`. Give it ≥2 GB RAM.
- **GPU** — install the CUDA torch build instead of the CPU index; the same
  image works.

Then set the Convex environment variables (Convex dashboard → Settings →
Environment Variables, or `npx convex env set`):

```bash
VSH_ANTISPOOF_URL   https://<your-host>      # this service
VSH_ANTISPOOF_KEY   <same value as VSA_API_KEY>
VSH_SEPARATE_URL    https://<your-host>      # optional, for music mode
HF_TOKEN            hf_...                   # optional, Whisper transcription
VSH_TTS_PROVIDER    chatterbox | cartesia | elevenlabs | openai
VSH_TTS_KEY         <provider key>
VSH_TTS_BASE_URL    https://<your-host>      # only for the chatterbox provider
VSH_CLONE_PER_HOUR  5
```

## Optional: vocal separation

```bash
pip install 'demucs>=4.0'
export VSA_ENABLE_SEPARATION=1
```

`POST /v1/separate` runs `demucs -d cpu --two-stems=vocals -n htdemucs`.
Demucs is MIT licensed ([repo](https://github.com/facebookresearch/demucs));
budget roughly **1.5× realtime on CPU** (~4–5 minutes for a 3-minute song, per
the Demucs README) — the endpoint caps input at 8 minutes and this is why the
app treats separation as best-effort and reports the full mix regardless.

## Optional: voice cloning

```bash
pip install chatterbox-tts
export VSA_ENABLE_TTS=1
```

[Chatterbox](https://github.com/resemble-ai/chatterbox) (Resemble AI) is
**MIT** licensed and runs on CPU; the 110M "Nano" checkpoint is advertised at
~3× realtime on an 8-core CPU ([model card](https://huggingface.co/ResembleAI/chatterbox-nano/blob/main/README.md)).
Prefer a GPU for the 500M model. Hosted alternatives (Cartesia, ElevenLabs,
OpenAI-compatible TTS) are already implemented as adapters in
`src/lib/server/provider.ts` — set `VSH_TTS_PROVIDER` accordingly; only the
chatterbox provider uses this endpoint.

Every `/clone` output is watermarked (WAV `LIST/INFO/ICMT` comment + shown in
the UI) and the safeguards (consent, ownership challenge, script screen, rate
limit) are enforced in the Convex action **before** this service is called.

## API sketch

```bash
curl -X POST https://<host>/v1/score \
  -H "authorization: Bearer $VSA_API_KEY" \
  -H "content-type: application/json" \
  -d "{\"audio_base64\": \"$(base64 -w0 clip.wav)\", \"sample_rate\": 16000, \"window_sec\": 4, \"hop_sec\": 2}"
# -> {"model": "...", "license": "...", "global_score": 0.83, "windows": [{"start": 0.0, "end": 4.0, "p": 0.81}, ...], "latency_ms": 412}
```

Client-side contract: `src/lib/server/provider.ts` (request/response shapes,
error mapping) and `src/lib/audio/learned.ts` (what the browser sends).
