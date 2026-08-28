// voice.js — Indian English male TTS for Pathey
// Uses Microsoft Edge Neural TTS (en-IN-PrabhatNeural @ +10% speed, +5Hz pitch)
// Fallback: en-US-ChristopherNeural if Indian voice unavailable
// Fallback 2: PowerShell System.Speech if offline
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let currentSayProcess = null;
let activeProcesses = [];
let currentSpeakSessionId = 0;
let audioCounter = 0;
let currentAudioQueue = [];
let isPlayingQueue = false;

const AUDIO_TMP = path.join(os.tmpdir(), 'pathey-tts');
try { fs.mkdirSync(AUDIO_TMP, { recursive: true }); } catch (_) {}

const PRIMARY_VOICE = 'en-IN-PrabhatNeural';
const PRIMARY_RATE = '+10%';
const PRIMARY_PITCH = '+5Hz';
const FALLBACK_VOICE = 'en-US-ChristopherNeural';
const FALLBACK_RATE = '+5%';
const FALLBACK_PITCH = '+0Hz';

const PYTHON_EXE = process.env.PYTHON_EXE || 'py';
const PYTHON_ARGS = process.env.PYTHON_EXE ? [] : ['-3'];

/**
 * Split text into natural sentence chunks for micro-pause cadence.
 * Returns an array of sentence strings.
 */
function splitIntoSentences(text) {
  // Split on sentence-ending punctuation followed by whitespace
  const raw = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];
  const sentences = raw.map(s => s.trim()).filter(s => s.length > 0);
  // Merge very short fragments (< 15 chars) into the previous sentence
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

/**
 * Generate human-quality speech using Python edge-tts.
 * Voice: en-IN-PrabhatNeural @ +10% speed, +5Hz pitch
 * Natural micro-pauses between sentences for conversational cadence.
 * Falls back to PowerShell if Python or network is unavailable.
 */
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

  const sentences = splitIntoSentences(cleanText);

  // For short text (1-2 sentences), generate a single audio file
  if (sentences.length <= 2) {
    generateAndPlay(cleanText, mainWindow, sessionId);
    return;
  }

  // For longer text, generate per-sentence with micro-pauses
  currentAudioQueue = [];
  isPlayingQueue = true;
  let completed = 0;
  const total = sentences.length;

  sentences.forEach((sentence, idx) => {
    const mp3File = path.join(AUDIO_TMP, `pathey_${++audioCounter}_s${idx}.mp3`);
    currentAudioQueue.push({ file: mp3File, ready: false, idx, text: sentence });

    const args = [
      '-m', 'edge_tts',
      '--voice', PRIMARY_VOICE,
      '--rate', PRIMARY_RATE,
      '--pitch', PRIMARY_PITCH,
      '--text', sentence,
      '--write-media', mp3File
    ];

    try {
      const proc = spawn(PYTHON_EXE, [...PYTHON_ARGS, ...args], { windowsHide: true });
      activeProcesses.push(proc);
      proc.on('exit', (code) => {
        activeProcesses = activeProcesses.filter(p => p !== proc);
        if (sessionId !== currentSpeakSessionId) return;

        if (code === 0 && fs.existsSync(mp3File) && fs.statSync(mp3File).size > 100) {
          if (currentAudioQueue[idx]) currentAudioQueue[idx].ready = true;
        }
        completed++;
        // Start playback as soon as the first sentence is ready
        if (sessionId === currentSpeakSessionId && (completed === 1 || (completed <= total && currentAudioQueue[0] && currentAudioQueue[0].ready))) {
          playQueuedAudio(mainWindow, sessionId);
        }
      });
    } catch (err) {
      completed++;
      console.warn(`[Pathey Voice] Sentence ${idx} spawn error:`, err.message);
    }
  });
}

/**
 * Generate a single audio file and play it directly.
 */
function generateAndPlay(text, mainWindow, sessionId) {
  const mp3File = path.join(AUDIO_TMP, `pathey_${++audioCounter}.mp3`);

  const args = [
    '-m', 'edge_tts',
    '--voice', PRIMARY_VOICE,
    '--rate', PRIMARY_RATE,
    '--pitch', PRIMARY_PITCH,
    '--text', text,
    '--write-media', mp3File
  ];

  try {
    const proc = spawn(PYTHON_EXE, [...PYTHON_ARGS, ...args], { windowsHide: true });
    currentSayProcess = proc;
    activeProcesses.push(proc);

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('exit', (code) => {
      activeProcesses = activeProcesses.filter(p => p !== proc);
      if (currentSayProcess === proc) currentSayProcess = null;
      if (sessionId !== currentSpeakSessionId) return;

      if (code === 0 && fs.existsSync(mp3File) && fs.statSync(mp3File).size > 100) {
        console.log(`[Pathey Voice] ${PRIMARY_VOICE} success: ${mp3File}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('play-tts-audio', mp3File, { text });
        }
      } else {
        console.warn(`[Pathey Voice] ${PRIMARY_VOICE} failed (${code}), trying fallback...`);
        generateWithFallback(text, mainWindow, sessionId);
      }
    });
  } catch (err) {
    console.warn('[Pathey Voice] Spawn error:', err.message);
    generateWithFallback(text, mainWindow, sessionId);
  }
}

function generateWithFallback(text, mainWindow, sessionId) {
  const mp3File = path.join(AUDIO_TMP, `pathey_fb_${++audioCounter}.mp3`);

  const args = [
    '-m', 'edge_tts',
    '--voice', FALLBACK_VOICE,
    '--rate', FALLBACK_RATE,
    '--pitch', FALLBACK_PITCH,
    '--text', text,
    '--write-media', mp3File
  ];

  try {
    const proc = spawn(PYTHON_EXE, [...PYTHON_ARGS, ...args], { windowsHide: true });
    currentSayProcess = proc;
    activeProcesses.push(proc);

    proc.on('exit', (code) => {
      activeProcesses = activeProcesses.filter(p => p !== proc);
      if (currentSayProcess === proc) currentSayProcess = null;
      if (sessionId !== currentSpeakSessionId) return;

      if (code === 0 && fs.existsSync(mp3File) && fs.statSync(mp3File).size > 100) {
        console.log(`[Pathey Voice] Fallback ${FALLBACK_VOICE} success: ${mp3File}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('play-tts-audio', mp3File);
        }
      } else {
        console.warn('[Pathey Voice] Fallback also failed, using PowerShell...');
        speakPowerShellFallback(text, mainWindow, sessionId);
      }
    });
  } catch (_) {
    speakPowerShellFallback(text, mainWindow, sessionId);
  }
}

/**
 * Play queued sentence audio files sequentially with micro-pauses.
 * Each sentence gets a 180ms pause after it finishes for natural cadence.
 */
function playQueuedAudio(mainWindow, sessionId) {
  if (sessionId && sessionId !== currentSpeakSessionId) return;
  if (!isPlayingQueue || !mainWindow || mainWindow.isDestroyed()) return;
  
  // Find the next unplayed sentence in order
  const nextItem = currentAudioQueue.find(q => !q.played);
  if (!nextItem) return;

  if (nextItem.ready) {
    nextItem.played = true;
    console.log(`[Pathey Voice] Playing sentence ${nextItem.idx} (+5%, +0Hz): ${nextItem.file}`);
    mainWindow.webContents.send('play-tts-audio', nextItem.file, {
      queueNext: true,
      microPauseMs: 60,
      sentenceIdx: nextItem.idx,
      text: nextItem.text
    });
  }
}

/**
 * Called from preload when a queued audio finishes playing.
 * Triggers the next sentence with micro-pause delay.
 */
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
  setTimeout(checkNext, 60); // 60ms natural human pause between sentences
}

/**
 * Fallback: PowerShell System.Speech (used if offline)
 * Rate tuned to 1 (moderate) to match primary engine's cadence.
 */
function speakPowerShellFallback(cleanText, mainWindow, sessionId) {
  const wavFile = path.join(AUDIO_TMP, `pathey_fb_${++audioCounter}.wav`);
  const psScript = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Male);
$synth.Rate = 1;
$synth.Volume = 100;
$synth.SetOutputToWaveFile('${wavFile.replace(/\\/g, '\\\\')}');
$synth.Speak("${cleanText.replace(/"/g, ' ')}");
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

function speak(text, mainWindow) {
  speakNeural(text, mainWindow);
}

let _mainWindowRef = null;

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

