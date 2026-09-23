#!/usr/bin/env python3
"""
Vosk offline speech recognition for Pathey AI.
Streams microphone audio → Vosk engine → JSON transcripts on stdout.

Output protocol (one JSON per line on stdout):
  {"type": "partial", "text": "hello wor"}         ← interim/partial result
  {"type": "final",   "text": "hello world"}       ← final confirmed result
  {"type": "status",  "text": "ready"}             ← engine ready
  {"type": "error",   "text": "..."}               ← error message

The Electron main process spawns this script and reads stdout line-by-line.
"""

import sys
import os
import json
import queue
import zipfile
import urllib.request
import shutil
import sounddevice as sd
import numpy as np
from vosk import Model, KaldiRecognizer

# ─── Configuration ───────────────────────────────────────────────────────
SAMPLE_RATE = 16000
BLOCK_SIZE = 2000  # ~125ms low-latency chunks at 16kHz
RMS_THRESHOLD = 120  # RMS noise gate threshold to filter out ambient static while keeping soft voice

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(SCRIPT_DIR, "vosk-model")
# Large-graph model: 128MB, 200k+ words (songs, movies, brands, proper nouns)
MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip"
MODEL_ZIP_NAME = "vosk-model-en-us-0.22-lgraph"

def log_status(text):
    """Send a status message to Electron via stdout."""
    print(json.dumps({"type": "status", "text": text}), flush=True)

def log_error(text):
    """Send an error message to Electron via stdout."""
    print(json.dumps({"type": "error", "text": text}), flush=True)

def is_model_valid(dir_path):
    """Check if dir_path exists and contains valid Vosk model files."""
    if not os.path.isdir(dir_path):
        return False
    try:
        entries = os.listdir(dir_path)
        required = ["am", "conf", "graph", "ivector"]
        return any(req in entries for req in required)
    except Exception:
        return False

def download_model():
    """Download and extract the Vosk model if not present."""
    if is_model_valid(MODEL_DIR):
        return True

    alt_dir = os.path.join(SCRIPT_DIR, MODEL_ZIP_NAME)
    if is_model_valid(alt_dir):
        try:
            shutil.copytree(alt_dir, MODEL_DIR, dirs_exist_ok=True)
            shutil.rmtree(alt_dir, ignore_errors=True)
            return True
        except Exception:
            pass

    log_status("downloading_model")
    zip_path = os.path.join(SCRIPT_DIR, "vosk-model.zip")

    if os.path.exists(zip_path):
        try:
            os.remove(zip_path)
        except Exception:
            pass

    try:
        def reporthook(count, block_size, total_size):
            if total_size > 0:
                pct = int(count * block_size * 100 / total_size)
                pct = min(pct, 100)
                log_status(f"downloading_model_{pct}%")

        urllib.request.urlretrieve(MODEL_URL, zip_path, reporthook)

        log_status("extracting_model")
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(SCRIPT_DIR)

        if os.path.isdir(alt_dir):
            shutil.copytree(alt_dir, MODEL_DIR, dirs_exist_ok=True)
            shutil.rmtree(alt_dir, ignore_errors=True)

        try:
            os.remove(zip_path)
        except Exception:
            pass

        return is_model_valid(MODEL_DIR)
    except Exception as e:
        log_error(f"Model download failed: {e}")
        if os.path.exists(zip_path):
            try:
                os.remove(zip_path)
            except Exception:
                pass
        return False

def main():
    if not download_model():
        log_error("Vosk model initialization failed.")
        sys.exit(1)

    log_status("loading_model")
    try:
        model = Model(MODEL_DIR)
    except Exception as e:
        log_error(f"Failed to load Vosk model: {e}")
        sys.exit(1)

    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(True)

    audio_queue = queue.Queue()

    def audio_callback(indata, frames, time_info, status):
        # Ignore buffer overflow status warnings to prevent noisy error output
        if status and "overflow" not in str(status).lower() and "underflow" not in str(status).lower():
            log_error(f"Audio status: {status}")

        audio_data = np.frombuffer(indata, dtype=np.int16)
        rms = np.sqrt(np.mean(audio_data.astype(np.float32) ** 2)) if len(audio_data) > 0 else 0

        # Noise gate: if audio volume is below room noise threshold, pass silence
        if rms < RMS_THRESHOLD:
            audio_queue.put(b'\x00' * len(indata))
        else:
            audio_queue.put(bytes(indata))

    log_status("starting_mic")
    try:
        stream = sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            dtype='int16',
            channels=1,
            callback=audio_callback
        )
        stream.start()
    except Exception as e:
        log_error(f"Microphone error: {e}")
        sys.exit(1)

    log_status("ready")

    try:
        while True:
            data = audio_queue.get()

            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                text = result.get("text", "").strip()
                if text and len(text) > 1:
                    print(json.dumps({"type": "final", "text": text}), flush=True)
            else:
                partial = json.loads(recognizer.PartialResult())
                text = partial.get("partial", "").strip()
                if text and len(text) > 1:
                    print(json.dumps({"type": "partial", "text": text}), flush=True)

    except KeyboardInterrupt:
        pass
    except Exception as e:
        log_error(f"Recognition error: {e}")
    finally:
        try:
            stream.stop()
            stream.close()
        except Exception:
            pass

        try:
            final = json.loads(recognizer.FinalResult())
            text = final.get("text", "").strip()
            if text and len(text) > 1:
                print(json.dumps({"type": "final", "text": text}), flush=True)
        except Exception:
            pass

if __name__ == "__main__":
    main()

