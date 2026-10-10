"""VoiceShield backend service.

Three endpoints, all optional except the first:

  POST /v1/score     anti-spoofing score for a WAV clip (required)
  POST /v1/separate  Demucs vocal separation (VSA_ENABLE_SEPARATION=1)
  POST /v1/clone     Chatterbox zero-shot voice cloning (VSA_ENABLE_TTS=1)
  GET  /health       liveness + configuration summary (no secrets)

The learned model is a Hugging Face wav2vec2 anti-spoofing checkpoint loaded
with `transformers`. The default (see backend/README.md for model cards,
licenses and benchmarks) is Apache-2.0 licensed with downloadable weights and
a preprocessor; set VSA_MODEL_ID to swap in a different checkpoint.

Auth: every endpoint expects `Authorization: Bearer $VSA_API_KEY` when
VSA_API_KEY is set. Point the Convex action's VSH_ANTISPOOF_KEY at the same
value so only your deployment can be used.
"""

from __future__ import annotations

import base64
import binascii
import io
import os
import subprocess
import tempfile
import time
import uuid

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from scipy.signal import resample_poly

TARGET_SR = 16000
MODEL_ID = os.environ.get("VSA_MODEL_ID", "MelodyMachine/Deepfake-audio-detection-V2")
MODEL_LICENSE = os.environ.get("VSA_MODEL_LICENSE", "apache-2.0 (see model card)")
API_KEY = os.environ.get("VSA_API_KEY")
MAX_SECONDS = float(os.environ.get("VSA_MAX_SECONDS", "600"))

app = FastAPI(title="VoiceShield anti-spoofing service", version="1.0.0")

processor = None
model = None


def _load_model() -> None:
    global processor, model
    if processor is not None:
        return
    from transformers import AutoModelForAudioClassification, AutoProcessor

    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForAudioClassification.from_pretrained(MODEL_ID)
    model.eval()


def _require_auth(authorization: str | None) -> None:
    if API_KEY is None:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="missing or invalid API key")


def _decode_audio(audio_base64: str, fallback_sr: int) -> tuple[np.ndarray, int]:
    try:
        raw = base64.b64decode(audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as 400
        raise HTTPException(status_code=400, detail=f"could not decode audio: {exc}") from exc
    if data.ndim > 1:
        data = data.mean(axis=1)
    sr = sr or fallback_sr
    if sr != TARGET_SR:
        gcd = np.gcd(int(sr), TARGET_SR)
        data = resample_poly(data, TARGET_SR // gcd, int(sr) // gcd).astype(np.float32)
        sr = TARGET_SR
    if data.shape[0] / sr > MAX_SECONDS:
        raise HTTPException(status_code=413, detail=f"audio longer than {MAX_SECONDS:.0f}s")
    return data, sr


def _synthetic_probability(window: np.ndarray) -> float:
    """Probability that one window is synthetic, robust to label naming."""
    assert processor is not None and model is not None
    inputs = processor(
        window, sampling_rate=TARGET_SR, return_tensors="pt", padding=True
    )
    with torch_no_grad():
        logits = model(**inputs).logits[0]
    probs = _softmax(logits.detach().numpy())
    id2label = {int(k): str(v).lower() for k, v in (model.config.id2label or {}).items()}
    for index, label in id2label.items():
        if any(word in label for word in ("fake", "synth", "spoof", "ai", "generated")):
            return float(probs[index])
    # Unknown labelling: assume index 1 is the positive (spoof) class.
    return float(probs[1] if probs.shape[0] > 1 else probs[0])


def torch_no_grad():
    import torch

    return torch.no_grad()


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max()
    exp = np.exp(shifted)
    return exp / exp.sum()


class ScoreRequest(BaseModel):
    audio_base64: str
    sample_rate: int = TARGET_SR
    window_sec: float = 4.0
    hop_sec: float = 2.0


class WindowScore(BaseModel):
    start: float
    end: float
    p: float


class ScoreResponse(BaseModel):
    model: str
    license: str
    global_score: float
    windows: list[WindowScore]
    latency_ms: int


@app.get("/health")
def health(authorization: str | None = Header(None)) -> dict:
    return {
        "status": "ok",
        "model": MODEL_ID,
        "license": MODEL_LICENSE,
        "separation": os.environ.get("VSA_ENABLE_SEPARATION") == "1",
        "tts": os.environ.get("VSA_ENABLE_TTS") == "1",
        "auth_required": API_KEY is not None,
    }


@app.post("/v1/score", response_model=ScoreResponse)
def score(request: ScoreRequest, authorization: str | None = Header(None)) -> ScoreResponse:
    _require_auth(authorization)
    started = time.time()
    data, _sr = _decode_audio(request.audio_base64, request.sample_rate)
    _load_model()

    window_len = max(1.0, request.window_sec) * TARGET_SR
    hop_len = max(0.5, request.hop_sec) * TARGET_SR

    scores: list[WindowScore] = []
    start = 0
    while start + TARGET_SR <= data.shape[0]:  # ignore sub-second remainders
        chunk = data[int(start) : int(start + window_len)]
        if chunk.shape[0] < window_len:
            chunk = np.pad(chunk, (0, int(window_len - chunk.shape[0])))
        probability = _synthetic_probability(chunk)
        scores.append(
            WindowScore(
                start=round(start / TARGET_SR, 3),
                end=round((start + chunk.shape[0]) / TARGET_SR, 3),
                p=round(probability, 4),
            )
        )
        start += hop_len

    if not scores:
        # Shorter than one window: score the whole clip as one window.
        scores.append(WindowScore(start=0.0, end=round(data.shape[0] / TARGET_SR, 3), p=round(_synthetic_probability(data), 4)))

    global_score = float(np.mean([window.p for window in scores]))
    return ScoreResponse(
        model=MODEL_ID,
        license=MODEL_LICENSE,
        global_score=round(global_score, 4),
        windows=scores,
        latency_ms=int((time.time() - started) * 1000),
    )


class SeparateRequest(BaseModel):
    audio_base64: str


@app.post("/v1/separate")
def separate(request: SeparateRequest, authorization: str | None = Header(None)) -> dict:
    _require_auth(authorization)
    if os.environ.get("VSA_ENABLE_SEPARATION") != "1":
        raise HTTPException(status_code=501, detail="vocal separation is not enabled on this deployment")
    data, sr = _decode_audio(request.audio_base64, TARGET_SR)
    if data.shape[0] / sr > 8 * 60:
        raise HTTPException(status_code=413, detail="separation is limited to 8 minutes of audio")

    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, f"{uuid.uuid4().hex}.wav")
        sf.write(source, data, sr)
        try:
            subprocess.run(
                [
                    "demucs",
                    "-d",
                    "cpu",
                    "--two-stems=vocals",
                    "-n",
                    "htdemucs",
                    "-o",
                    tmp,
                    source,
                ],
                check=True,
                timeout=900,
                capture_output=True,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=501, detail="demucs is not installed") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="separation timed out") from exc
        vocals_path = os.path.join(tmp, "htdemucs", os.path.splitext(os.path.basename(source))[0], "vocals.wav")
        if not os.path.exists(vocals_path):
            raise HTTPException(status_code=500, detail="separation produced no vocals stem")
        with open(vocals_path, "rb") as handle:
            vocals_b64 = base64.b64encode(handle.read()).decode("ascii")
    return {"vocals_base64": vocals_b64}


class CloneRequest(BaseModel):
    text: str
    reference_audio: str
    reference_format: str = "audio/wav"


_chatterbox = None


@app.post("/v1/clone")
def clone(request: CloneRequest, authorization: str | None = Header(None)):
    """Zero-shot cloning with the MIT-licensed Chatterbox model (self-hosted)."""
    _require_auth(authorization)
    if os.environ.get("VSA_ENABLE_TTS") != "1":
        raise HTTPException(status_code=501, detail="voice cloning is not enabled on this deployment")
    text = request.text.strip()
    if not (3 <= len(text) <= 600):
        raise HTTPException(status_code=400, detail="text length out of range")

    global _chatterbox
    try:
        from chatterbox.tts import ChatterboxTTS
    except ImportError as exc:
        raise HTTPException(status_code=501, detail="chatterbox-tts is not installed") from exc
    if _chatterbox is None:
        device = "cuda" if _has_cuda() else "cpu"
        _chatterbox = ChatterboxTTS.from_pretrained(device=device)

    data, sr = _decode_audio(request.reference_audio, TARGET_SR)
    if not (10 <= data.shape[0] / sr <= 90):
        raise HTTPException(status_code=400, detail="reference must be 10-90 seconds")

    with tempfile.TemporaryDirectory() as tmp:
        reference = os.path.join(tmp, "reference.wav")
        sf.write(reference, data, sr)
        wav = _chatterbox.generate_speech(text, reference)
    audio = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
    buffer = io.BytesIO()
    sf.write(buffer, audio, getattr(_chatterbox, "sr", TARGET_SR), format="WAV")
    return {"audio": base64.b64encode(buffer.getvalue()).decode("ascii"), "sample_rate": int(getattr(_chatterbox, "sr", TARGET_SR))}


def _has_cuda() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False
