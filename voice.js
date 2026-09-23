// voice.js — Fast Neural TTS for Pathey
// Uses raw WebSocket to Microsoft Edge TTS API (no Python, no axios)
// Voice: en-IN-PrabhatNeural @ +15% speed, +5Hz pitch
// Strategy:
//   1. Pre-warm WebSocket connection at startup
//   2. If ready → generate audio in-process (fast, persistent)
//   3. If not ready yet → PowerShell System.Speech (instant fallback)

const WebSocket = require('ws');
const { spawn } = require('child_process');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AUDIO_TMP = path.join(os.tmpdir(), 'pathey-tts');
try { fs.mkdirSync(AUDIO_TMP, { recursive: true }); } catch (_) {}

// ─── Edge TTS constants ───────────────────────────────────────────────────
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}`;

const PRIMARY_VOICE = 'en-IN-PrabhatNeural';
const PRIMARY_RATE = '+15%';
const PRIMARY_PITCH = '+5Hz';

// ─── TLS bypass agent (avoids Windows CRL revocation delay) ──────────────
const FAST_AGENT = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  keepAliveMsecs: 30000
});

// ─── State ────────────────────────────────────────────────────────────────
let currentSayProcess = null;
let activeProcesses = [];
let currentSpeakSessionId = 0;
let audioCounter = 0;
let currentAudioQueue = [];
let isPlayingQueue = false;
let _mainWindowRef = null;

// ─── WebSocket TTS Engine ─────────────────────────────────────────────────
let _ws = null;
let _wsReady = false;
let _wsConnecting = false;
let _wsQueue = {};  // requestId -> { chunks: Buffer[], resolve, reject }
let _wsReconnectTimer = null;

function _nowMs() { return Date.now(); }

function _makeRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function _configMsg() {
  return `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-96kbitrate-mono-mp3"}}}}`;
}

function _ssmlMsg(requestId, text, rate, pitch) {
  const locale = 'en-IN';
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${PRIMARY_VOICE}"><prosody pitch="${pitch}" rate="${rate}">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</prosody></voice></speak>`;
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
}

function connectWS() {
  if (_wsConnecting || _wsReady) return;
  _wsConnecting = true;
  console.log('[Pathey Voice] Connecting to Edge TTS WebSocket...');

  const ws = new WebSocket(WSS_URL, {
    agent: FAST_AGENT,
    rejectUnauthorized: false,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'chrome-extension://jdiccldimpdaibocqbgmlgflmjhnflho',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    }
  });

  ws.binaryType = 'nodebuffer';

  ws.on('open', () => {
    _ws = ws;
    _wsReady = true;
    _wsConnecting = false;
    console.log('[Pathey Voice] ✓ Edge TTS WebSocket connected (persistent)');
    // Send config message
    ws.send(_configMsg(), () => {});
  });

  ws.on('message', (data) => {
    try {
      if (Buffer.isBuffer(data)) {
        // Binary audio data
        const str = data.toString('utf8', 0, Math.min(200, data.length));
        const reqMatch = str.match(/X-RequestId:([a-f0-9]+)/i);
        if (!reqMatch) return;
        const requestId = reqMatch[1];
        const delim = 'Path:audio\r\n';
        const idx = data.indexOf(delim);
        if (idx > -1 && _wsQueue[requestId]) {
          const audioChunk = data.slice(idx + delim.length);
          _wsQueue[requestId].chunks.push(audioChunk);
        }
      } else {
        // Text message
        const msg = data.toString();
        const reqMatch = msg.match(/X-RequestId:([a-f0-9]+)/i);
        if (!reqMatch) return;
        const requestId = reqMatch[1];

        if (msg.includes('Path:turn.end') && _wsQueue[requestId]) {
          const entry = _wsQueue[requestId];
          delete _wsQueue[requestId];
          const combined = Buffer.concat(entry.chunks);
          entry.resolve(combined);
        }
      }
    } catch (e) {
      console.warn('[Pathey Voice] WS message error:', e.message);
    }
  });

  ws.on('close', (code) => {
    console.warn('[Pathey Voice] WebSocket closed:', code);
    _ws = null;
    _wsReady = false;
    _wsConnecting = false;
    // Reject all pending requests
    Object.values(_wsQueue).forEach(entry => {
      try { entry.reject(new Error('WebSocket closed')); } catch (_) {}
    });
    _wsQueue = {};
    // Auto-reconnect after 2s
    if (!_wsReconnectTimer) {
      _wsReconnectTimer = setTimeout(() => {
        _wsReconnectTimer = null;
        connectWS();
      }, 2000);
    }
  });

  ws.on('error', (err) => {
    console.warn('[Pathey Voice] WebSocket error:', err.message);
    _wsConnecting = false;
    // close handler will fire next
  });
}

/**
 * Synthesize text to audio buffer via persistent WebSocket.
 */
function synthesize(text) {
  if (!_wsReady || !_ws || _ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('WebSocket not ready'));
  }

  const requestId = _makeRequestId();
  return new Promise((resolve, reject) => {
    _wsQueue[requestId] = { chunks: [], resolve, reject };

    const ssml = _ssmlMsg(requestId, text, PRIMARY_RATE, PRIMARY_PITCH);
    _ws.send(ssml, (err) => {
      if (err) {
        delete _wsQueue[requestId];
        reject(err);
      }
    });

    // Timeout safety
    setTimeout(() => {
      if (_wsQueue[requestId]) {
        delete _wsQueue[requestId];
        reject(new Error('TTS synthesis timeout'));
      }
    }, 20000);
  });
}

/**
 * Generate an MP3 file using the persistent WebSocket TTS.
 */
async function generateAudioWS(text, mp3File) {
  try {
    const audioData = await synthesize(text);
    if (!audioData || audioData.length < 100) return false;
    fs.writeFileSync(mp3File, audioData);
    return true;
  } catch (err) {
    console.warn('[Pathey Voice] WS synthesize failed:', err.message);
    return false;
  }
}

// ─── Sentence splitter ────────────────────────────────────────────────────
function splitIntoSentences(text) {
  const raw = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];
  const sentences = raw.map(s => s.trim()).filter(s => s.length > 0);
  const merged = [];
  for (const s of sentences) {
    if (merged.length > 0 && s.length < 15) {
      merged[merged.length - 1] += ' ' + s;
    } else {
      merged.push(s);
    }
  }
  return merged.length > 0 ? merged : [text];
}

// ─── Main speak logic ─────────────────────────────────────────────────────
function speakNeural(text, mainWindow) {
  if (!text || typeof text !== 'string') return;
  stopSpeech(mainWindow);

  const sessionId = ++currentSpeakSessionId;

  const cleanText = text
    .replace(/```[\s\S]*?```/g, 'Code omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*#_~>]/g, '')
    .replace(/["\\]/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 1500);

  if (!cleanText) return;

  if (_wsReady && _ws && _ws.readyState === WebSocket.OPEN) {
    // Fast path: use Node.js WS TTS (no Python spawn)
    _speakWithWS(cleanText, mainWindow, sessionId);
  } else {
    // Not ready: use PowerShell immediately, warm WS in background
    console.log('[Pathey Voice] WS not ready — using PowerShell (instant)');
    speakPowerShellFallback(cleanText, mainWindow, sessionId);
    connectWS(); // try to connect for future calls
  }
}

function _speakWithWS(cleanText, mainWindow, sessionId) {
  const sentences = splitIntoSentences(cleanText);

  if (sentences.length <= 2) {
    _generateAndPlay(cleanText, mainWindow, sessionId);
    return;
  }

  // Parallel generation, sequential playback
  currentAudioQueue = [];
  isPlayingQueue = true;
  let completed = 0;
  const total = sentences.length;

  sentences.forEach((sentence, idx) => {
    const mp3File = path.join(AUDIO_TMP, `pathey_${++audioCounter}_s${idx}.mp3`);
    currentAudioQueue.push({ file: mp3File, ready: false, idx, text: sentence });

    generateAudioWS(sentence, mp3File).then((ok) => {
      if (sessionId !== currentSpeakSessionId) return;
      if (ok && currentAudioQueue[idx]) currentAudioQueue[idx].ready = true;
      completed++;
      if (completed === 1 || (currentAudioQueue[0] && currentAudioQueue[0].ready)) {
        playQueuedAudio(mainWindow, sessionId);
      }
    }).catch(() => { completed++; });
  });
}

function _generateAndPlay(text, mainWindow, sessionId) {
  const mp3File = path.join(AUDIO_TMP, `pathey_${++audioCounter}.mp3`);

  generateAudioWS(text, mp3File).then((ok) => {
    if (sessionId !== currentSpeakSessionId) return;
    if (ok) {
      console.log(`[Pathey Voice] ✓ WS TTS success: ${mp3File}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('play-tts-audio', mp3File, { text });
      }
    } else {
      console.warn('[Pathey Voice] WS TTS failed, using PowerShell...');
      speakPowerShellFallback(text, mainWindow, sessionId);
    }
  }).catch(() => {
    speakPowerShellFallback(text, mainWindow, sessionId);
  });
}

// ─── Queued audio playback ────────────────────────────────────────────────
function playQueuedAudio(mainWindow, sessionId) {
  if (sessionId && sessionId !== currentSpeakSessionId) return;
  if (!isPlayingQueue || !mainWindow || mainWindow.isDestroyed()) return;
  const nextItem = currentAudioQueue.find(q => !q.played);
  if (!nextItem) return;
  if (nextItem.ready) {
    nextItem.played = true;
    mainWindow.webContents.send('play-tts-audio', nextItem.file, {
      queueNext: true, microPauseMs: 60, sentenceIdx: nextItem.idx, text: nextItem.text
    });
  }
}

function onQueuedAudioEnded(mainWindow) {
  if (!isPlayingQueue) return;
  const sessionCheckId = currentSpeakSessionId;
  const checkNext = () => {
    if (!isPlayingQueue || sessionCheckId !== currentSpeakSessionId) return;
    const nextItem = currentAudioQueue.find(q => !q.played);
    if (!nextItem) return;
    if (nextItem.ready) {
      playQueuedAudio(mainWindow, sessionCheckId);
    } else {
      setTimeout(checkNext, 40);
    }
  };
  setTimeout(checkNext, 60);
}

// ─── PowerShell fallback (immediate, offline) ─────────────────────────────
function speakPowerShellFallback(cleanText, mainWindow, sessionId) {
  const wavFile = path.join(AUDIO_TMP, `pathey_ps_${++audioCounter}.wav`);
  const safeTxt = cleanText.replace(/"/g, ' ').replace(/'/g, ' ').slice(0, 400);
  const psScript = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Male);
$synth.Rate = 2;
$synth.Volume = 100;
$synth.SetOutputToWaveFile('${wavFile.replace(/\\/g, '\\\\')}');
$synth.Speak("${safeTxt}");
$synth.Dispose();
`;
  try {
    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript], { windowsHide: true });
    currentSayProcess = proc;
    activeProcesses.push(proc);
    proc.on('exit', (code) => {
      activeProcesses = activeProcesses.filter(p => p !== proc);
      if (currentSayProcess === proc) currentSayProcess = null;
      if (sessionId !== currentSpeakSessionId) return;
      if (code === 0 && fs.existsSync(wavFile) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('play-tts-audio', wavFile, { text: cleanText });
      }
    });
  } catch (_) {}
}

// ─── Public API ────────────────────────────────────────────────────────────
function speak(text, mainWindow) {
  speakNeural(text, mainWindow);
}

function stopSpeech(mainWindow) {
  currentSpeakSessionId++;
  isPlayingQueue = false;
  currentAudioQueue = [];

  if (currentSayProcess) {
    try { currentSayProcess.kill(); } catch (_) {}
    currentSayProcess = null;
  }
  for (const proc of activeProcesses) {
    try { proc.kill(); } catch (_) {}
  }
  activeProcesses = [];

  const win = mainWindow || _mainWindowRef;
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('stop-tts-audio'); } catch (_) {}
  }
}

function setMainWindow(win) {
  _mainWindowRef = win;
  // Start connecting as soon as window is available
  setTimeout(() => connectWS(), 1000);
}

// Cleanup old temp audio files on startup
function cleanupOldAudio() {
  try {
    const files = fs.readdirSync(AUDIO_TMP);
    for (const f of files) {
      if (f.startsWith('pathey_')) {
        try { fs.unlinkSync(path.join(AUDIO_TMP, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}
cleanupOldAudio();

module.exports = {
  speak,
  stopSpeech,
  setMainWindow,
  onQueuedAudioEnded
};
