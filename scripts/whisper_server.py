#!/usr/bin/env python3
"""
Local Whisper transcription server for Pathey.
Uses faster-whisper for accurate, offline speech-to-text.
"""

import os
import sys
import tempfile
import wave
import logging
from pathlib import Path

try:
    from flask import Flask, request, jsonify
    from faster_whisper import WhisperModel
except ImportError as e:
    print(f"[Whisper Server] Missing dependency: {e}")
    print("[Whisper Server] Install with: pip install faster-whisper flask")
    sys.exit(1)

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper-server")

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small.en")
WHISPER_PORT = int(os.environ.get("WHISPER_PORT", 5005))

_model = None

def decode_to_wav(input_path, output_path, sample_rate=16000):
    """Decode any audio format (webm/opus/wav/etc.) to 16kHz mono WAV using PyAV."""
    import av

    container = av.open(input_path)
    stream = container.streams.audio[0]

    resampler = av.AudioResampler(
        format="s16",
        layout="mono",
        rate=sample_rate
    )

    samples = []
    for frame in container.decode(stream):
        frame.pts = None
        for out_frame in resampler.resample(frame):
            arr = out_frame.to_ndarray().flatten()
            samples.append(arr)
    for out_frame in resampler.resample(None):
        arr = out_frame.to_ndarray().flatten()
        samples.append(arr)
    container.close()

    if not samples:
        raise RuntimeError(f"No audio frames decoded from {input_path}")

    import numpy as np
    pcm = np.concatenate(samples).astype("<i2")

    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())

    logger.info(f"[Whisper Server] Decoded to WAV: {len(pcm) / sample_rate:.2f}s")

def get_model():
    global _model
    if _model is None:
        model_dir = os.environ.get("WHISPER_MODEL_DIR")
        logger.info(f"[Whisper Server] Loading model: {MODEL_SIZE}")
        logger.info(f"[Whisper Server] Model directory: {model_dir or 'default cache'}")
        
        device = "cuda"
        compute_type = "float16"
        try:
            import torch
            if not torch.cuda.is_available():
                device = "cpu"
                compute_type = "int8"
                logger.info("[Whisper Server] CUDA not available, using CPU")
        except ImportError:
            device = "cpu"
            compute_type = "int8"
            logger.info("[Whisper Server] PyTorch not found, using CPU")
        
        try:
            if model_dir:
                _model = WhisperModel(
                    model_dir,
                    device=device,
                    compute_type=compute_type
                )
            else:
                _model = WhisperModel(
                    MODEL_SIZE,
                    device=device,
                    compute_type=compute_type
                )
            logger.info(f"[Whisper Server] Model loaded successfully on {device}")
        except Exception as e:
            logger.error(f"[Whisper Server] Failed to load model: {e}")
            raise
    return _model


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_SIZE})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
    
    audio_file = request.files["audio"]
    if audio_file.filename == "":
        return jsonify({"error": "Empty filename"}), 400
    
    temp_path = None
    wav_path = None
    try:
        suffix = Path(audio_file.filename).suffix or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            audio_file.save(f.name)
            temp_path = f.name
        
        logger.info(f"[Whisper Server] Received: {audio_file.filename} (content-type: {audio_file.content_type})")
        
        wav_path = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
        decode_to_wav(temp_path, wav_path)
        
        model = get_model()
        segments, info = model.transcribe(wav_path, beam_size=5)
        
        text = " ".join(segment.text.strip() for segment in segments)
        
        logger.info(f"[Whisper Server] Transcribed: {text[:100]}...")
        
        return jsonify({
            "text": text.strip(),
            "language": info.language,
            "language_probability": round(info.language_probability, 2),
            "duration": round(info.duration, 2)
        })
    
    except Exception as e:
        logger.error(f"[Whisper Server] Transcription error: {e}")
        return jsonify({"error": str(e)}), 500
    
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except:
                pass


@app.route("/status", methods=["GET"])
def status():
    try:
        model = get_model()
        return jsonify({
            "loaded": True,
            "model": MODEL_SIZE,
            "device": str(getattr(model, "device", "unknown"))
        })
    except:
        return jsonify({
            "loaded": False,
            "model": MODEL_SIZE
        })


if __name__ == "__main__":
    logger.info(f"[Whisper Server] Starting on port {WHISPER_PORT}")
    logger.info(f"[Whisper Server] Model: {MODEL_SIZE}")
    
    print(f"WHISPER_READY_PORT={WHISPER_PORT}", flush=True)
    
    app.run(
        host="127.0.0.1",
        port=WHISPER_PORT,
        threaded=True,
        debug=False
    )
