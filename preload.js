// preload.js — Context bridge for Pathey
// Uses only edge-tts (en-IN-PrabhatNeural) — no browser speech synthesis

const { contextBridge, ipcRenderer } = require('electron');

let ttsAudioEndedCallbacks = [];

contextBridge.exposeInMainWorld('api', {
  chat: (message, options) => ipcRenderer.invoke('chat', message, options),
  speak: (text) => {
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio = null; } catch (_) {}
    }
    return ipcRenderer.invoke('speak', text);
  },
  setMuted: (muted) => ipcRenderer.invoke('set-muted', muted),
  stopSpeech: () => ipcRenderer.invoke('stop-speech'),
  runTool: (tool, args) => ipcRenderer.invoke('run-tool', { tool, args }),
  reset: () => ipcRenderer.invoke('reset'),
  getMemory: () => ipcRenderer.invoke('get-memory'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  startVoiceCapture: () => ipcRenderer.invoke('start-voice-capture'),
  stopVoiceCapture: () => ipcRenderer.invoke('stop-voice-capture'),
  startVosk: () => ipcRenderer.invoke('start-vosk'),
  stopVosk: () => ipcRenderer.invoke('stop-vosk'),
  getSpeechConfig: () => ipcRenderer.invoke('get-speech-config'),
  onVoskTranscript: (callback) => {
    ipcRenderer.removeAllListeners('vosk-transcript');
    ipcRenderer.on('vosk-transcript', (_event, data) => callback(data));
  },
  onVoiceCaptureText: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('voice-capture-text', handler);
    return () => ipcRenderer.removeListener('voice-capture-text', handler);
  },
  onPlanUpdate: (callback) => {
    const handler = (_event, update) => callback(update);
    ipcRenderer.on('plan-update', handler);
    return () => ipcRenderer.removeListener('plan-update', handler);
  },
  onTtsAudioEnded: (callback) => {
    ttsAudioEndedCallbacks.push(callback);
    return () => {
      ttsAudioEndedCallbacks = ttsAudioEndedCallbacks.filter((cb) => cb !== callback);
    };
  },
  whisperTranscribe: (audioDataUrl) => ipcRenderer.invoke('whisper-transcribe', audioDataUrl),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),
  startWhisper: () => ipcRenderer.invoke('start-whisper'),
  stopWhisper: () => ipcRenderer.invoke('stop-whisper')
});

// ─── Neural TTS Audio Player ────────────────────────────────────────────
let currentAudio = null;
let currentAudioSessionId = 0;
let ttsMuted = false;

contextBridge.exposeInMainWorld('tts', {
  speak: (text, opts = {}) => {
    if (!text || typeof text !== 'string') return;
    if (ttsMuted) return;
    currentAudioSessionId++;
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio.src = '';
        if (currentAudio.parentNode) currentAudio.parentNode.removeChild(currentAudio);
      } catch (_) {}
      currentAudio = null;
    }
    ipcRenderer.invoke('speak', text);
  },

  stop: () => {
    currentAudioSessionId++;
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio.src = '';
        if (currentAudio.parentNode) currentAudio.parentNode.removeChild(currentAudio);
      } catch (_) {}
      currentAudio = null;
    }
    ipcRenderer.invoke('stop-tts-audio').catch(() => {});
    ipcRenderer.invoke('stop-speech').catch(() => {});
  },

  setMuted: (muted) => {
    ttsMuted = !!muted;
    if (ttsMuted) {
      currentAudioSessionId++;
      if (currentAudio) {
        try {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio.src = '';
          if (currentAudio.parentNode) currentAudio.parentNode.removeChild(currentAudio);
        } catch (_) {}
        currentAudio = null;
      }
      ipcRenderer.invoke('stop-tts-audio').catch(() => {});
      ipcRenderer.invoke('stop-speech').catch(() => {});
    }
  },

  getVoices: () => []
});

let preferredAudioDeviceId = null;

async function findBluetoothAudioDevice() {
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      return null;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    console.log('[Pathey TTS] Audio output devices:', outputs.map(d => ({ id: d.deviceId, label: d.label })));

    const realDevices = outputs.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    if (realDevices.length === 0) {
      console.log('[Pathey TTS] No real hardware output devices found, using system default');
      return null;
    }

    const btPattern = /bluetooth|headphone|headset|earpod|earphone|airpods|beats|wireless/i;
    const handsFreePattern = /hands[- ]free|hfp|telephon|AG Audio|hands-free/i;

    const btStereo = realDevices.filter(d =>
      btPattern.test(d.label || '') && !handsFreePattern.test(d.label || '')
    );
    if (btStereo.length > 0) {
      console.log('[Pathey TTS] Routing audio to Bluetooth stereo device:', btStereo[0].label);
      return btStereo[0].deviceId;
    }

    const btAny = realDevices.filter(d => btPattern.test(d.label || ''));
    if (btAny.length > 0) {
      console.log('[Pathey TTS] Routing audio to Bluetooth device:', btAny[0].label);
      return btAny[0].deviceId;
    }

    console.log('[Pathey TTS] Using system default audio output');
    return null;
  } catch (err) {
    console.warn('[Pathey TTS] Device enumeration failed:', err);
    return null;
  }
}

function refreshPreferredAudioDevice() {
  findBluetoothAudioDevice().then(deviceId => {
    if (deviceId) {
      preferredAudioDeviceId = deviceId;
      console.log('[Pathey TTS] Preferred audio device:', preferredAudioDeviceId);
    }
  }).catch(() => {});
}

refreshPreferredAudioDevice();
setInterval(refreshPreferredAudioDevice, 10000);

// Listen for neural TTS audio files from main process
ipcRenderer.on('play-tts-audio', (_event, audioFilePath, opts = {}) => {
  if (!audioFilePath) return;
  if (ttsMuted) return;
  const sessionId = ++currentAudioSessionId;
  console.log('[Pathey TTS] Playing neural audio session:', sessionId, audioFilePath, opts);

  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
      if (currentAudio.parentNode) currentAudio.parentNode.removeChild(currentAudio);
    } catch (_) {}
    currentAudio = null;
  }

  const fileUrl = encodeURI(`file:///${audioFilePath.replace(/\\/g, '/')}`);
  const audio = new Audio(fileUrl);
  audio.preload = 'auto';
  audio.volume = 1.0;
  audio.setAttribute('playsinline', 'true');
  currentAudio = audio;

  let attachedEl = null;
  let finishedAudio = false;

  const finishAudio = (reason) => {
    if (sessionId !== currentAudioSessionId) return;
    if (finishedAudio) return;
    finishedAudio = true;
    if (currentAudio === audio) currentAudio = null;
    if (attachedEl && attachedEl.parentNode) {
      try { attachedEl.parentNode.removeChild(attachedEl); } catch (_) {}
    }
    attachedEl = null;
    try { audio.pause(); audio.src = ''; } catch (_) {}
    if (opts && opts.queueNext && reason !== 'abort') {
      ipcRenderer.invoke('tts-queue-next').catch(() => {});
    }
    ttsAudioEndedCallbacks.forEach((cb) => { try { cb(); } catch (_) {} });
    ipcRenderer.send('delete-tts-audio', audioFilePath);
  };

  audio.onended = () => finishAudio('ended');
  audio.onabort = () => finishAudio('abort');
  audio.onerror = () => finishAudio('error');

  const playAudio = () => {
    if (sessionId !== currentAudioSessionId) return;
    if (document && document.body) {
      try { document.body.appendChild(audio); attachedEl = audio; } catch (_) {}
    }
    audio.play().catch(err => {
      console.warn('[Pathey TTS] Audio play() failed:', err);
      finishAudio('error');
    });
  };

  const routeAndPlay = async () => {
    let deviceId = preferredAudioDeviceId;
    if (!deviceId) {
      deviceId = await findBluetoothAudioDevice();
      if (deviceId) preferredAudioDeviceId = deviceId;
    }

    if (sessionId !== currentAudioSessionId) return;

    if (deviceId && deviceId !== 'default' && deviceId !== 'communications' && typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(deviceId);
        console.log('[Pathey TTS] Audio routed to device:', deviceId);
      } catch (err) {
        console.warn('[Pathey TTS] setSinkId failed:', err);
      }
    }
    playAudio();
  };

  routeAndPlay();
});

ipcRenderer.on('stop-tts-audio', () => {
  currentAudioSessionId++;
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
      if (currentAudio.parentNode) currentAudio.parentNode.removeChild(currentAudio);
    } catch (_) {}
    currentAudio = null;
  }
});

