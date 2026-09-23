// main.js — Electron main process for Pathey
const path = require('path');
const http = require('http');
const os = require('os');
const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard } = require('electron');

// Enable sound auto-play without requiring prior user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { loadEnv, getBasePath } = require('./paths');
const { speak, stopSpeech, setMainWindow, onQueuedAudioEnded } = require('./voice');
loadEnv();
const { getAIResponse, clearHistory, getRawPlanFromAI, researchWithGoogle } = require('./ai');
const { saveMemory, logActivity, appendMemory, readMemory, extractRememberText, extractProjectLink, appendProjectLink, findProjectLink } = require('./memory');
const { extractToolCall, normalizeUrl, shouldStopAfterToolCall, isYouTubeWatchUrl, isGenericYouTubeUrl, extractYouTubeVideoIdFromHtml, extractYouTubeVideoIdsFromHtml, searchYouTubeVideos, scoreYouTubeCandidate, extractQuotedPhrases, isYouTubeVideoUnavailableHtml, isResearchRequest } = require('./browser_utils');
let mainWindow = null;
let serverProcess = null;
let voiceCaptureProcess = null;
let voiceCaptureFile = null;
let voiceCapturePoll = null;
let voiceCaptureBuffer = '';
let voiceCaptureLastLength = 0;
let activeYouTubeChannelFilter = null;
let voiceMuted = false;
let voskProcess = null;
let voskLineBuffer = '';
let whisperProcess = null;
let whisperPort = 5005;
let whisperReady = false;

function sendVoiceCaptureTextToWindow(text) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('voice-capture-text', text);
  }
}

function cleanupVoiceCapture() {
  if (voiceCapturePoll) {
    clearInterval(voiceCapturePoll);
    voiceCapturePoll = null;
  }
  if (voiceCaptureProcess) {
    try {
      voiceCaptureProcess.kill();
    } catch (_) {}
    voiceCaptureProcess = null;
  }
  voiceCaptureBuffer = '';
  voiceCaptureLastLength = 0;
  voiceCaptureFile = null;
}

function ensureLocalServer() {
  if (serverProcess || process.env.PATHEY_NO_SERVER) return;
  const serverScript = path.join(__dirname, 'server.js');
  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: __dirname,
    stdio: 'inherit'
  });
  serverProcess.on('exit', (code, signal) => {
    if (!serverProcess || serverProcess.killed) return;
    console.warn(`[Pathey] Local server exited with code ${code || signal || 'unknown'}`);
    serverProcess = null;
  });
}

function startWhisperServer() {
  if (whisperProcess || process.env.PATHEY_NO_WHISPER) return;
  
  const whisperScript = path.join(__dirname, 'scripts', 'whisper_server.py');
  if (!fs.existsSync(whisperScript)) {
    console.warn('[Pathey Whisper] Server script not found:', whisperScript);
    return;
  }

  const pythonCmd = process.env.PYTHON_CMD || 'python';
  const modelSize = process.env.WHISPER_MODEL || 'small.en';
  
  console.log(`[Pathey Whisper] Starting server with ${pythonCmd}, model: ${modelSize}`);
  
  whisperProcess = spawn(pythonCmd, [whisperScript], {
    cwd: __dirname,
    env: {
      ...process.env,
      WHISPER_MODEL: modelSize,
      WHISPER_PORT: String(whisperPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  whisperProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    console.log(`[Whisper Server] ${text}`);
    if (text.startsWith('WHISPER_READY_PORT=')) {
      const port = parseInt(text.split('=')[1], 10);
      if (!isNaN(port)) whisperPort = port;
      whisperReady = true;
      console.log(`[Pathey Whisper] Server ready on port ${whisperPort}`);
    }
  });

  whisperProcess.stderr.on('data', (data) => {
    console.warn(`[Whisper Server] ${data.toString().trim()}`);
  });

  whisperProcess.on('error', (err) => {
    console.warn('[Pathey Whisper] Failed to start:', err.message);
    whisperProcess = null;
    whisperReady = false;
  });

  whisperProcess.on('exit', (code, signal) => {
    if (!whisperProcess || whisperProcess.killed) return;
    console.warn(`[Pathey Whisper] Server exited with code ${code || signal || 'unknown'}`);
    whisperProcess = null;
    whisperReady = false;
  });
}

function stopWhisperServer() {
  if (whisperProcess) {
    try {
      whisperProcess.kill();
    } catch (_) {}
    whisperProcess = null;
    whisperReady = false;
  }
}

async function transcribeWithWhisper(audioFilePath, mimeType) {
  if (!whisperReady) {
    throw new Error('Whisper server not ready');
  }
  
  return new Promise((resolve, reject) => {
    const boundary = '----PatheyWhisperBoundary' + Date.now();
    const audioData = fs.readFileSync(audioFilePath);
    const filename = path.basename(audioFilePath);
    const contentType = mimeType || 'audio/webm';
    
    const payload = [];
    payload.push(`--${boundary}\r\n`);
    payload.push(`Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n`);
    payload.push(`Content-Type: ${contentType}\r\n\r\n`);
    const payloadBuffer = Buffer.concat([
      Buffer.from(payload.join(''), 'utf8'),
      audioData,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    ]);

    const req = http.request({
      hostname: '127.0.0.1',
      port: whisperPort,
      path: '/transcribe',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payloadBuffer.length
      },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.text) {
            resolve(data.text);
          } else if (data.error) {
            reject(new Error(data.error));
          } else {
            reject(new Error('No transcription returned'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Whisper request timeout'));
    });
    
    req.write(payloadBuffer);
    req.end();
  });
}
function waitForLocalServer(port, timeout = 10000, interval = 200) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: interval }, (res) => {
        res.destroy();
        resolve();
      });

      req.on('error', (err) => {
        if (Date.now() - start >= timeout) {
          reject(err);
        } else {
          setTimeout(tryConnect, interval);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start >= timeout) {
          reject(new Error('Timeout waiting for local server'));
        } else {
          setTimeout(tryConnect, interval);
        }
      });
    };
    tryConnect();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#05070b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  setMainWindow(mainWindow);
  startWhisperServer();
  startVoskProcess();
  // Load the local file directly so the preload bridge (window.api) is injected.
  // Loading over http://localhost:3000 skips preload scripts, which breaks all
  // window-control / voice buttons (they fall back to no-op web stubs).
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((err) => {
    console.error('[Pathey] Failed to load index.html:', err);
    mainWindow.loadURL('data:text/html;charset=utf-8,%3Ch1%3EPathey%20unavailable%3C%2Fh1%3E%3Cp%3EUnable%20to%20load%20the%20interface.%3C%2Fp%3E');
  });
}

function findWindowsApp(name) {
  const { execSync } = require('child_process');
  
  if (path.isAbsolute(name) && fs.existsSync(name)) {
    return name;
  }
  
  const cleanName = name.replace(/\.exe$/i, '').trim().toLowerCase();
  
  try {
    const stdout = execSync(`where "${cleanName}.exe" 2>nul || where "${cleanName}" 2>nul`, { encoding: 'utf8' });
    const paths = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    if (paths.length > 0 && fs.existsSync(paths[0])) {
      return paths[0];
    }
  } catch (err) {}
  
  const findLocally = (dir, target, currentDepth, maxDepth) => {
    if (currentDepth > maxDepth) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // 1. Exact matches first
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.toLowerCase().endsWith('.exe') || entry.name.toLowerCase().endsWith('.lnk'))) {
          const entryName = entry.name.replace(/\.(exe|lnk)$/i, '').toLowerCase();
          if (entryName === target) {
            return path.join(dir, entry.name);
          }
        }
      }
      // 2. Substring matches second
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.toLowerCase().endsWith('.exe') || entry.name.toLowerCase().endsWith('.lnk'))) {
          const entryName = entry.name.replace(/\.(exe|lnk)$/i, '').toLowerCase();
          if (entryName.includes(target)) {
            return path.join(dir, entry.name);
          }
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'System Volume Information') {
          const res = findLocally(path.join(dir, entry.name), target, currentDepth + 1, maxDepth);
          if (res) return res;
        }
      }
    } catch (_) {}
    return null;
  };

  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
  
  const targets = [
    { dir: path.join(localAppData, 'Programs'), maxDepth: 2 },
    { dir: path.join(localAppData, 'CapCut', 'Apps'), maxDepth: 2 },
    { dir: path.join(process.env.ProgramFiles || 'C:\\Program Files'), maxDepth: 2 },
    { dir: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'), maxDepth: 2 },
    { dir: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), maxDepth: 3 },
    { dir: path.join(appData, 'Microsoft\\Windows\\Start Menu\\Programs'), maxDepth: 3 }
  ];

  for (const target of targets) {
    if (fs.existsSync(target.dir)) {
      const match = findLocally(target.dir, cleanName, 0, target.maxDepth);
      if (match) return match;
    }
  }

  return null;
}

async function confirmAction(actionDescription) {
  console.log(`[Pathey] Autonomously executing: ${actionDescription}`);
  return true;
}

function extractProjectOpenRequest(message) {
  if (!message || typeof message !== 'string') return null;
  const match = message.trim().match(/^(?:open|launch|go to|show|browse)\s+(?:my\s+)?(.+?)\s+(?:repo|link|github(?:\s+repo)?|project|site|website)(?:\s+repo)?$/i);
  if (!match) return null;
  const projectName = match[1].trim();
  return projectName || null;
}

const YT_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function isYouTubeWatchUrlPlayable(watchUrl) {
  try {
    const res = await fetch(watchUrl, { headers: YT_FETCH_HEADERS });
    if (!res.ok) return false;
    const html = await res.text();
    return !isYouTubeVideoUnavailableHtml(html);
  } catch (_) {
    return false;
  }
}

async function pickBestYouTubeVideo(query, fallbackUrl, channelFilter = '') {
  if (!query) return null;
  const candidates = await searchYouTubeVideos(query);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => scoreYouTubeCandidate(b, query, channelFilter) - scoreYouTubeCandidate(a, query, channelFilter));
  const filterLower = (channelFilter || '').toLowerCase().trim();
  for (const candidate of candidates) {
    if (filterLower && !(candidate.channel || '').toLowerCase().includes(filterLower)) continue;
    const watchUrl = `https://www.youtube.com/watch?v=${candidate.videoId}`;
    if (await isYouTubeWatchUrlPlayable(watchUrl)) {
      console.log(`[YouTube Resolver] Auto-playing "${candidate.title || 'unknown'}" by ${candidate.channel || 'unknown'} (${candidate.viewsText || '0 views'}) -> ${watchUrl}`);
      return watchUrl;
    }
  }
  return fallbackUrl || null;
}

async function executeTool(toolCall) {
  const { tool, args = {} } = toolCall || {};
  const name = tool || 'unknown';
  if (name === 'list_directory') {
    const target = args.path || '.';
    logActivity('list_directory', target);
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      return JSON.stringify(entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })), null, 2);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'read_file') {
    const target = args.path;
    if (!target) return 'No path provided.';
    logActivity('read_file', target);
    try {
      return fs.readFileSync(target, 'utf8');
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'git_status') {
    const target = args.path || __dirname;
    logActivity('git_status', target);
    try {
      const output = await new Promise((resolve, reject) => {
        exec('git status --short', { cwd: target }, (error, stdout, stderr) => {
          if (error && !stdout && !stderr) return reject(error);
          resolve((stdout || stderr || '').trim());
        });
      });
      return output || 'No git status output.';
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'run_command') {
    const cmd = args.cmd;
    if (!cmd) return 'No command provided.';
    const confirmed = await confirmAction(`run command: ${cmd}`);
    if (!confirmed) return 'Cancelled by user.';
    logActivity('run_command', cmd);
    try {
      const output = await new Promise((resolve) => {
        exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
          const result = (stdout || stderr || (error ? error.message : 'Command completed with no output.')).trim();
          resolve(result);
        });
      });
      return output;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'write_file') {
    const target = args.path;
    const content = args.content;
    if (!target) return 'No path provided.';
    const confirmed = await confirmAction(`write file: ${target}`);
    if (!confirmed) return 'Cancelled by user.';
    logActivity('write_file', target);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content || '', 'utf8');
      return `Wrote file: ${target}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'open_url') {
    let url = normalizeUrl(args.url || args.link || '');
    if (!url) return 'No URL provided.';

    // Safety net: intercept any search-engine query URL → redirect to research
    // Skip YouTube and direct portals (ChatGPT, Gemini, Claude, Mail)
    const isYouTube = isYouTubeWatchUrl(url) || isGenericYouTubeUrl(url);
    const isDirectPortal = /chatgpt\.com|claude\.ai|gemini\.google\.com|mail\.google\.com|outlook\.live\.com/i.test(url);
    if (!isYouTube && !isDirectPortal && !args.forceBrowser) {
      const KNOWN_SEARCH_ENGINES = /(?:google\.com\/search|bing\.com\/search|duckduckgo\.com|search\.yahoo\.com|search\.brave\.com|search\.aol\.com|ask\.com|startpage\.com|ecosia\.org\/search|yandex\.com\/search)/i;
      const SEARCH_PARAM_RE = /[?&](?:q|query|p|text)=([^&#]+)/i;
      const SEARCH_PATH_RE = /\/(?:search|results)\b/i;
      const isKnownEngine = KNOWN_SEARCH_ENGINES.test(url);
      const hasSearchParam = SEARCH_PARAM_RE.test(url);
      const hasSearchPath = SEARCH_PATH_RE.test(url);
      if (isKnownEngine || hasSearchParam || hasSearchPath) {
        const queryMatch = url.match(SEARCH_PARAM_RE);
        const query = queryMatch ? decodeURIComponent(queryMatch[1]) : (args.searchQuery || 'general search');
        logActivity('open_url_redirected_to_research', { originalUrl: url, query });
        const researchResult = await runResearch(query);
        return researchResult;
      }
    }

    // YouTube URL handling: always resolve to a direct, playable watch URL.
    if (isYouTubeWatchUrl(url)) {
      const playable = await isYouTubeWatchUrlPlayable(url);
      if (!playable) {
        console.warn(`[YouTube Resolver] Watch URL not playable: ${url}`);
        if (args.searchQuery) {
          const resolved = await pickBestYouTubeVideo(args.searchQuery, null, activeYouTubeChannelFilter);
          if (resolved) {
            url = resolved;
          } else {
            return `The video at ${url} is unavailable and I couldn't find a working version. Please tell me the exact song/video name and artist.`;
          }
        } else {
          return `The video link ${url} is unavailable. Please give me the exact song name and artist and I will find and play the official video.`;
        }
      }
    } else if (isGenericYouTubeUrl(url)) {
      let searchQuery = args.searchQuery || '';
      try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('youtube.com') && parsed.pathname === '/results') {
          searchQuery = parsed.searchParams.get('search_query') || searchQuery;
        }
      } catch (_) {}
      const resolved = searchQuery ? await pickBestYouTubeVideo(searchQuery, null, activeYouTubeChannelFilter) : null;
      if (resolved) {
        url = resolved;
      } else if (searchQuery) {
        return `I couldn't auto-resolve a playable video for "${searchQuery}". Please try again with the exact song name and artist.`;
      } else {
        return `Please provide a specific song or video to play.`;
      }
    }

    // Set clipboard if requested
    if (args.clipboard) {
      try {
        console.log(`[open_url] Setting clipboard using Electron API: ${args.clipboard}`);
        clipboard.writeText(args.clipboard);
      } catch (clipErr) {
        console.warn(`[open_url] Failed to write clipboard:`, clipErr.message);
      }
    }

    const confirmed = await confirmAction(`open URL: ${url}`);
    if (!confirmed) return 'Cancelled by user.';
    logActivity('open_url', url);
    try {
      const isChatbot = url.includes('chatgpt.com') || url.includes('claude.ai') || url.includes('gemini.google.com') || args.autoSubmit;
      const triggerAutoSubmit = () => {
        if (isChatbot && args.clipboard) {
          console.log(`[open_url] Chatbot auto-automation: Scheduling paste/submit in background`);
          const psCommand = `powershell.exe -NoProfile -Command ` + 
            `"$wshell = New-Object -ComObject wscript.shell; ` +
            `Start-Sleep -Seconds 2.5; ` +
            `$wshell.SendKeys('^v'); ` +
            `Start-Sleep -Milliseconds 300; ` +
            `$wshell.SendKeys('{ENTER}')"`;
          
          exec(psCommand, (err) => {
            if (err) console.warn('[open_url] Auto-automation script failed:', err.message);
          });
        }
      };

      if (args.browser) {
        const browserName = args.browser.trim().toLowerCase();
        const exeName = browserName.endsWith('.exe') ? browserName : `${browserName}.exe`;
        const browserPath = findWindowsApp(exeName);
        if (browserPath) {
          console.log(`[open_url] Spawning custom browser: ${browserPath} with URL: ${url}`);
          const child = spawn(browserPath, [url], { detached: true, stdio: 'ignore' });
          child.on('error', (spawnErr) => {
            console.error(`[open_url] Failed to launch custom browser '${exeName}':`, spawnErr.message);
          });
          child.unref();
          triggerAutoSubmit();
          return `Opened: ${url} in custom browser (${browserName})`;
        } else {
          console.warn(`[open_url] Custom browser '${browserName}' not found. Falling back to default browser...`);
        }
      }

      await shell.openExternal(url);
      triggerAutoSubmit();
      return `Opened: ${url}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  if (name === 'open_app') {
    const appName = args.name;
    if (!appName) return 'No app name provided.';
    const confirmed = await confirmAction(`open app: ${appName}`);
    if (!confirmed) return 'Cancelled by user.';
    logActivity('open_app', appName);
    try {
      const resolvedPath = findWindowsApp(appName);
      if (resolvedPath) {
        console.log(`[Pathey] Resolved app '${appName}' to '${resolvedPath}'`);
        const errStr = await shell.openPath(resolvedPath);
        if (errStr) {
          throw new Error(errStr);
        }
        return `Opened app: ${appName} (${path.basename(resolvedPath)})`;
      }
      
      console.log(`[Pathey] App path for '${appName}' not resolved, falling back to direct spawn`);
      const child = spawn(appName, { detached: true, stdio: 'ignore' });
      child.on('error', (spawnErr) => {
        console.error(`[Pathey] Spawn error for '${appName}':`, spawnErr.message);
      });
      child.unref();
      return `Opened app (spawn fallback): ${appName}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
  return `Unknown tool: ${name}`;
}
// Read-only tools can be parallelised safely
const READ_ONLY_TOOLS = new Set(['list_directory', 'read_file', 'git_status']);

function sendPlanUpdate(update) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('plan-update', update);
  }
}

function parsePlan(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.plan)) return null;
    if (parsed.plan.length === 0) return []; // conversational, no tools
    const steps = parsed.plan.slice(0, 8); // hard cap 8
    // validate each step has required fields
    for (const s of steps) {
      if (!s.tool || !s.parallel_group || typeof s.step !== 'number') return null;
    }
    return steps;
  } catch (_) {
    return null;
  }
}

async function executePlan(plan, userMessage) {
  const totalSteps = plan.length;
  const results = [];
  let cancelled = false;

  // Group steps by parallel_group, in order of first appearance
  const groupOrder = [];
  const groups = {};
  for (const step of plan) {
    const g = step.parallel_group;
    if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
    groups[g].push(step);
  }

  for (const groupKey of groupOrder) {
    if (cancelled) break;
    const groupSteps = groups[groupKey];
    const allReadOnly = groupSteps.every(s => READ_ONLY_TOOLS.has(s.tool));

    if (allReadOnly) {
      // Run all steps in this group concurrently
      sendPlanUpdate({ type: 'group-start', group: groupKey, steps: groupSteps.map(s => s.step) });
      const promises = groupSteps.map(async (step) => {
        sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'running', tool: step.tool });
        try {
          const res = await executeTool({ tool: step.tool, args: step.args || {} });
          sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'done', tool: step.tool, result: String(res).slice(0, 200) });
          return { step: step.step, tool: step.tool, result: res, ok: true };
        } catch (err) {
          sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'error', tool: step.tool });
          return { step: step.step, tool: step.tool, result: `Error: ${err.message}`, ok: false };
        }
      });
      const groupResults = await Promise.all(promises);
      results.push(...groupResults);
    } else {
      // Execute sequentially — each state-changing step needs its own loop pass
      for (const step of groupSteps) {
        if (cancelled) break;
        sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'running', tool: step.tool });
        const confirmed = await confirmAction(`Step ${step.step} of ${totalSteps}: Run '${step.tool}'${step.args && step.args.cmd ? ` → ${step.args.cmd}` : step.args && step.args.url ? ` → ${step.args.url}` : step.args && step.args.name ? ` → ${step.args.name}` : ''}`);
        if (!confirmed) {
          sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'skipped', tool: step.tool });
          results.push({ step: step.step, tool: step.tool, result: 'Cancelled by user.', ok: false });
          cancelled = true;
          break;
        }
        try {
          const res = await executeTool({ tool: step.tool, args: step.args || {} });
          sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'done', tool: step.tool, result: String(res).slice(0, 200) });
          results.push({ step: step.step, tool: step.tool, result: res, ok: true });
        } catch (err) {
          sendPlanUpdate({ type: 'step-status', step: step.step, total: totalSteps, status: 'error', tool: step.tool });
          results.push({ step: step.step, tool: step.tool, result: `Error: ${err.message}`, ok: false });
        }
      }
    }
  }

  sendPlanUpdate({ type: 'plan-done', cancelled });
  return { results, cancelled };
}

async function runResearch(query) {
  try {
    const result = await researchWithGoogle(query);
    if (!result) {
      logActivity('web_research', { query, groundedFalse: true, provider: null, sourceCount: 0 });
      return { research: true, error: true };
    }
    const sourceCount = result.sources ? result.sources.length : 0;
    logActivity('web_research', { query, groundedFalse: !!result.groundedFalse, provider: result.provider || 'gemini', sourceCount });
    return { research: true, ...result };
  } catch (err) {
    console.error('[Pathey Research] Failed:', err.message);
    logActivity('web_research', { query, groundedFalse: true, provider: null, sourceCount: 0 });
    return { research: true, error: true };
  }
}

async function runAgentLoop(userMessage, options = {}) {
  const memoryContext = await readMemory();

  // Step 1: Ask AI for a structured plan
  const rawPlan = await getRawPlanFromAI(userMessage, memoryContext);
  const plan = parsePlan(rawPlan);

  // No plan or empty plan → conversational reply, fall back to single-shot response
  if (plan === null || plan === undefined) {
    // plan parse failed → fall back to legacy single-step loop
    const history = [];
    const toolResults = [];
    let currentMessage = userMessage;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const response = await getAIResponse(currentMessage, memoryContext, options.model, history);
      const toolCall = extractToolCall(response);
      if (!toolCall) return response;
      history.push({ role: 'user', content: currentMessage });
      history.push({ role: 'assistant', content: response });
      const toolResult = await executeTool(toolCall);
      toolResults.push(`Step ${iteration + 1} (${toolCall.tool}): ${toolResult}`);
      history.push({ role: 'user', content: `Tool result for ${toolCall.tool}: ${toolResult}` });
      currentMessage = `Tool result for ${toolCall.tool}: ${toolResult}`;
      if (shouldStopAfterToolCall(toolCall)) {
        break;
      }
    }

    const synthesisPrompt = `You are Pathey, a helpful AI companion. You have just finished running tool calls to answer the user's request below.\n\nUser's request: "${userMessage}"\n\nTool results:\n${toolResults.join('\n')}\n\nUsing ONLY the information in the tool results above, write a clear, natural-language answer to the user's request. Do not mention tools or internal steps. If a tool result is empty, missing, or an error, say so plainly instead of guessing. Keep the tone conversational, not robotic.`;
    return await getAIResponse(synthesisPrompt, memoryContext, options.model, []);
  }

  if (plan.length === 0) {
    // Truly conversational — no tools, direct AI reply
    return await getAIResponse(userMessage, memoryContext, options.model, []);
  }

  // Broadcast plan to UI
  sendPlanUpdate({ type: 'plan-start', steps: plan });

  // Step 2: Execute plan
  const { results, cancelled } = await executePlan(plan, userMessage);

  // Step 3: Ask Gemini to summarise results in plain language
  const summaryContext = results.map(r =>
    `Step ${r.step} (${r.tool}): ${r.ok ? r.result : 'FAILED — ' + r.result}`
  ).join('\n');
  const summaryPrompt = `The user asked: "${userMessage}"\n\nHere are the results from executing the plan:\n${summaryContext}\n\n${cancelled ? 'The plan was cancelled partway through by the user.' : ''}\n\nWrite a concise plain-language summary of what was done and any key findings. Be direct and helpful.`;
  const summary = await getAIResponse(summaryPrompt, memoryContext, options.model, []);
  return summary;
}
ipcMain.handle('run-tool', async (_event, toolCall) => {
  return executeTool(toolCall);
});
ipcMain.handle('reset', async () => {
  clearHistory();
  return { ok: true };
});
ipcMain.handle('get-memory', async () => {
  return readMemory();
});
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const isFS = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFS);
    return !isFS;
  }
  return false;
});
ipcMain.handle('minimize-app', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('close-app', () => {
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('start-voice-capture', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Voice capture only supported on Windows.' };
  }
  if (voiceCaptureProcess) {
    return { ok: true, file: voiceCaptureFile };
  }

  const transcriptFile = path.join(getBasePath(), 'temp_voice_capture.txt');
  if (fs.existsSync(transcriptFile)) {
    try { fs.unlinkSync(transcriptFile); } catch (_) {}
  }

  const psScript = path.join(__dirname, 'voice_capture.ps1');
  voiceCaptureProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', psScript,
    '-TranscriptFile', transcriptFile
  ], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  voiceCaptureProcess.stderr.on('data', (chunk) => {
    console.warn('[Pathey Voice] capture stderr:', chunk.toString().trim());
  });

  voiceCaptureProcess.on('exit', (code, signal) => {
    console.warn('[Pathey Voice] capture exited', code, signal);
    cleanupVoiceCapture();
  });

  voiceCaptureFile = transcriptFile;
  voiceCaptureLastLength = 0;
  voiceCaptureBuffer = '';

  voiceCapturePoll = setInterval(() => {
    const captureFile = voiceCaptureFile;
    if (!captureFile) return;
    if (!fs.existsSync(captureFile)) return;
    try {
      const content = fs.readFileSync(captureFile, 'utf8');
      if (content.length < voiceCaptureLastLength) {
        voiceCaptureLastLength = 0;
        voiceCaptureBuffer = '';
      }
      if (content.length > voiceCaptureLastLength) {
        const chunk = content.slice(voiceCaptureLastLength);
        voiceCaptureLastLength = content.length;
        voiceCaptureBuffer += chunk;
        const lines = voiceCaptureBuffer.split(/\r?\n/);
        voiceCaptureBuffer = lines.pop() || '';
        for (const line of lines) {
          const normalized = String(line || '').trim();
          if (normalized) {
            sendVoiceCaptureTextToWindow(normalized);
          }
        }
      }
    } catch (_) {
      // ignore transient read errors
    }
  }, 500);

  return { ok: true, file: transcriptFile };
});
ipcMain.handle('stop-voice-capture', async () => {
  cleanupVoiceCapture();
  return { ok: true };
});

// ─── Vosk Offline Speech Recognition ────────────────────────────────────
function cleanupVosk() {
  if (voskProcess) {
    try { voskProcess.kill('SIGTERM'); } catch (_) {}
    voskProcess = null;
  }
  voskLineBuffer = '';
}

let _cleanedUp = false;
function cleanupAllProcesses() {
  if (_cleanedUp) return;
  _cleanedUp = true;
  console.log('[Pathey] Cleaning up child processes...');

  if (whisperProcess) {
    try { whisperProcess.kill(); } catch (_) {}
    whisperProcess = null;
    whisperReady = false;
  }

  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }

  cleanupVosk();
  cleanupVoiceCapture();
}

const PYTHON_EXE = process.env.PYTHON_EXE || (process.platform === 'win32' ? 'py' : 'python3');
const PYTHON_ARGS = (process.platform === 'win32' && !process.env.PYTHON_EXE) ? ['-3'] : [];

function startVoskProcess() {
  if (voskProcess) {
    return { ok: true, status: 'already_running' };
  }

  const scriptPath = path.join(__dirname, 'vosk_recognition.py');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'vosk_recognition.py not found' };
  }

  try {
    voskProcess = spawn(PYTHON_EXE, [...PYTHON_ARGS, scriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    voskLineBuffer = '';

    voskProcess.stdout.on('data', (chunk) => {
      voskLineBuffer += chunk.toString();
      const lines = voskLineBuffer.split('\n');
      voskLineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('vosk-transcript', msg);
          }
          if (msg.type === 'status') {
            console.log(`[Pathey Vosk] Status: ${msg.text}`);
          } else if (msg.type === 'final') {
            console.log(`[Pathey Vosk] Final: "${msg.text}"`);
          } else if (msg.type === 'error') {
            console.warn(`[Pathey Vosk] Error: ${msg.text}`);
          }
        } catch (parseErr) {
          console.warn('[Pathey Vosk] Non-JSON stdout:', trimmed);
        }
      }
    });

    voskProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.warn('[Pathey Vosk] stderr:', text);
    });

    voskProcess.on('exit', (code, signal) => {
      console.log(`[Pathey Vosk] Process exited (code=${code}, signal=${signal})`);
      voskProcess = null;
      voskLineBuffer = '';
    });

    return { ok: true, status: 'started' };
  } catch (err) {
    console.error('[Pathey Vosk] Failed to start:', err.message);
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('start-vosk', async () => {
  return startVoskProcess();
});

ipcMain.handle('stop-vosk', async () => {
  cleanupVosk();
  return { ok: true };
});

ipcMain.handle('get-speech-config', async () => {
  return {
    voskRunning: !!voskProcess,
    voiceCaptureRunning: !!voiceCaptureProcess,
    platform: process.platform
  };
});
ipcMain.handle('speak', async (_event, text) => {
  if (voiceMuted) return { ok: false, muted: true };
  if (typeof text === 'string' && text.trim()) {
    speak(text, mainWindow);
    return { ok: true };
  }
  return { ok: false, error: 'No text provided.' };
});
ipcMain.handle('set-muted', async (_event, muted) => {
  voiceMuted = !!muted;
  return { ok: true, muted: voiceMuted };
});
ipcMain.handle('stop-speech', async () => {
  stopSpeech(mainWindow);
  return { ok: true };
});
ipcMain.handle('stop-tts-audio', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stop-tts-audio');
  }
  return { ok: true };
});
ipcMain.handle('tts-queue-next', async () => {
  onQueuedAudioEnded(mainWindow);
  return { ok: true };
});
ipcMain.on('delete-tts-audio', (_event, audioFilePath) => {
  try {
    const tmpDir = path.join(os.tmpdir(), 'pathey-tts');
    const resolved = path.resolve(String(audioFilePath || ''));
    if (resolved.startsWith(tmpDir + path.sep) && path.basename(resolved).startsWith('pathey_')) {
      fs.unlink(resolved, () => {});
    }
  } catch (_) {}
});
function parseFastPathCommand(trimmed) {
  if (!trimmed || typeof trimmed !== 'string') return null;
  const clean = trimmed.trim();

  // Pattern matching AI service variations (STT robust)
  const aiPattern = '(?:chat\\s*g\\.?p\\.?t|chat-?gpt|chatgpt|gemini|geminy|jimini|claude|claud)';
  const aiPromptRegex = new RegExp(`^(?:open\\s+)?(${aiPattern})\\s+(?:and\\s+)?(?:prompt|ask|tell)(?:\\s+this|\\s+that|\\s+me|\\s+it)?\\s*[:,\\-]?\\s*(.+)$`, 'i');
  const askFirstRegex = new RegExp(`^(?:ask|prompt|tell)\\s+(${aiPattern})\\s+(?:to\\s+|that\\s+|about\\s+|this\\s+|me\\s+)?\\s*[:,\\-]?\\s*(.+)$`, 'i');

  let match = clean.match(aiPromptRegex) || clean.match(askFirstRegex);
  if (match) {
    let rawService = match[1].toLowerCase();
    let promptText = match[2].trim();
    promptText = promptText.replace(/^(?:this|that|to|about|me)\s+/i, '').trim();

    if (promptText) {
      let service = 'chatgpt';
      let name = 'ChatGPT';
      let url = 'https://chatgpt.com';

      if (/gem/i.test(rawService) || /jim/i.test(rawService)) {
        service = 'gemini';
        name = 'Gemini';
        url = 'https://gemini.google.com';
      } else if (/claud/i.test(rawService)) {
        service = 'claude';
        name = 'Claude';
        url = 'https://claude.ai';
      }

      return { type: 'ai_prompt', service, name, url, promptText };
    }
  }

  // 2. AI Direct Open Commands (without prompt)
  const aiOpenRegex = new RegExp(`^(?:open|launch|go to)\\s+(${aiPattern})$`, 'i');
  match = clean.match(aiOpenRegex);
  if (match) {
    let rawService = match[1].toLowerCase();
    let service = 'chatgpt';
    let name = 'ChatGPT';
    let url = 'https://chatgpt.com';

    if (/gem/i.test(rawService) || /jim/i.test(rawService)) {
      service = 'gemini';
      name = 'Gemini';
      url = 'https://gemini.google.com';
    } else if (/claud/i.test(rawService)) {
      service = 'claude';
      name = 'Claude';
      url = 'https://claude.ai';
    }

    return { type: 'ai_open', service, name, url };
  }

  // 3. Mail Commands
  const mailRegex = /^(?:check|open|show|read|go to|checking|opening)(?:\s+my)?\s+(?:mail|mails|email|emails|gmail|outlook)$/i;
  if (mailRegex.test(clean)) {
    let url = 'https://mail.google.com';
    let name = 'Gmail';
    if (/outlook/i.test(clean)) {
      url = 'https://outlook.live.com';
      name = 'Outlook Mail';
    }
    return { type: 'mail', url, name };
  }

  // 4. Web Search / Google Search Commands
  const searchGoogleRegex = /^(?:google\s+search|search\s+google\s+for|open\s+google\s+and\s+search|search\s+on\s+google)\s+(.+)$/i;
  const webSurfRegex = /^(?:surf\s+web\s+for|web\s+surf\s+for|web\s+surf|surf\s+the\s+web\s+for)\s+(.+)$/i;
  match = clean.match(searchGoogleRegex) || clean.match(webSurfRegex);
  if (match) {
    const query = match[1].trim();
    if (query) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      return { type: 'web_search', query, url };
    }
  }

  return null;
}

ipcMain.handle('chat', async (_event, message, options = {}) => {
  try {
    if (!message || !message.trim()) return 'Please say something!';
    const trimmed = message.trim();

    // Priority 1: Project link remember command
    const rememberText = extractRememberText(trimmed);
    if (rememberText) {
      const projectLink = extractProjectLink(rememberText);
      if (projectLink) {
        appendProjectLink(projectLink.projectName, projectLink.url);
        logActivity('project_link_saved', `${projectLink.projectName}: ${projectLink.url}`);
        return `Got it — saved your **${projectLink.projectName}** link: ${projectLink.url}\nNext time just say "open my ${projectLink.projectName} repo" and I'll open it directly.`;
      }
      // Regular remember (non-link)
      appendMemory(rememberText);
      logActivity('memory_saved', rememberText);
      return `Got it — I will remember: "${rememberText}"`;
    }

    const projectOpenRequest = extractProjectOpenRequest(trimmed);
    if (projectOpenRequest) {
      const storedUrl = findProjectLink(projectOpenRequest);
      if (storedUrl) {
        const url = normalizeUrl(storedUrl);
        const confirmed = await confirmAction(`open URL: ${url}`);
        if (!confirmed) return 'Cancelled by user.';
        logActivity('project_link_opened', `${projectOpenRequest}: ${url}`);
        try {
          await shell.openExternal(url);
          return `Opened: ${url}`;
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }
      return `I don't have that project's link saved yet. If you want, say "remember my ${projectOpenRequest} repo is <url>" and I'll save it for next time.`;
    }

    // Priority 2: Fast-Path Automation (AI Prompts, AI Opens, Mail, Google Search)
    const fastCmd = parseFastPathCommand(trimmed);
    if (fastCmd) {
      if (fastCmd.type === 'ai_prompt') {
        console.log(`[Pathey Fast-Path] AI Prompt command: ${fastCmd.name} -> "${fastCmd.promptText}"`);
        try {
          clipboard.writeText(fastCmd.promptText);
        } catch (cErr) {
          console.warn('[Pathey Fast-Path] Clipboard write error:', cErr.message);
        }
        await shell.openExternal(fastCmd.url);

        const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
          `"$wshell = New-Object -ComObject wscript.shell; ` +
          `Start-Sleep -Seconds 2.5; ` +
          `$wshell.SendKeys('^v'); ` +
          `Start-Sleep -Milliseconds 300; ` +
          `$wshell.SendKeys('{ENTER}')"`;

        exec(psCommand, (err) => {
          if (err) console.warn('[Pathey Fast-Path] Auto-submit script error:', err.message);
        });

        logActivity('fast_path_ai_prompt', `${fastCmd.name}: ${fastCmd.promptText}`);
        return `Opening ${fastCmd.name}, pasting your prompt, and submitting it for you automatically!`;
      }

      if (fastCmd.type === 'ai_open') {
        console.log(`[Pathey Fast-Path] AI Open command: ${fastCmd.name}`);
        await shell.openExternal(fastCmd.url);
        logActivity('fast_path_ai_open', fastCmd.name);
        return `Opening ${fastCmd.name} in your browser!`;
      }

      if (fastCmd.type === 'mail') {
        console.log(`[Pathey Fast-Path] Mail command: ${fastCmd.name}`);
        await shell.openExternal(fastCmd.url);
        logActivity('fast_path_mail', fastCmd.name);
        return `Opening your ${fastCmd.name} right now!`;
      }

      if (fastCmd.type === 'web_search') {
        console.log(`[Pathey Fast-Path] Web Search command: "${fastCmd.query}"`);
        await shell.openExternal(fastCmd.url);
        logActivity('fast_path_web_search', fastCmd.query);
        return `Searching Google for "${fastCmd.query}" in your browser!`;
      }
    }

    if (isResearchRequest(trimmed)) {
      return await runResearch(trimmed);
    }

    const quotedPhrases = extractQuotedPhrases(trimmed);
    if (quotedPhrases.length) {
      activeYouTubeChannelFilter = quotedPhrases.reduce((a, b) => (b.length > a.length ? b : a));
      console.log(`[YouTube Resolver] Quoted channel filter active: "${activeYouTubeChannelFilter}"`);
    }
    let reply;
    try {
      reply = await runAgentLoop(trimmed, options);
    } finally {
      activeYouTubeChannelFilter = null;
    }

    // Clean up any residual Ctrl+V paste instructions
    if (typeof reply === 'string') {
      reply = reply.replace(/I (?:copied|have copied) your question to the clipboard so you can paste it with \*\*Ctrl\+V\*\*/gi, 'I have copied your question, opened the interface, and will paste/submit it for you automatically!');
      reply = reply.replace(/you can paste it with \*\*Ctrl\+V\*\*/gi, 'I am pasting and submitting it for you automatically!');
      reply = reply.replace(/paste it using \*\*Ctrl\+V\*\*/gi, 'I am pasting and submitting it for you automatically!');
      reply = reply.replace(/paste it with Ctrl\+V/gi, 'I am pasting and submitting it for you automatically!');
      reply = reply.replace(/use \*\*Ctrl\+V\*\* to paste/gi, 'automating paste/submit');
    }

    saveMemory(trimmed, reply);
    logActivity('chat', trimmed);
    return reply;
  } catch (err) {
    console.error('Chat handler error:', err);
    return `Something went wrong: ${err.message}`;
  }
});
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`[Pathey Main] Permission requested: '${permission}' from ${webContents ? webContents.getURL() : 'unknown'}`);
    callback(true);
  });

  if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return true;
    });
  }

  if (typeof session.defaultSession.setDevicePermissionHandler === 'function') {
    session.defaultSession.setDevicePermissionHandler((details) => {
      console.log('[Pathey Main] Device permission:', details.deviceType, details.deviceName || '');
      return true;
    });
  }

  if (typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({});
    });
  }

  createWindow();
});
app.on('window-all-closed', () => {
  cleanupAllProcesses();
  app.quit();
});
app.on('before-quit', () => {
  cleanupAllProcesses();
});
app.on('will-quit', () => {
  cleanupAllProcesses();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('whisper-transcribe', async (_event, audioDataUrl) => {
  if (!whisperReady) {
    return { ok: false, error: 'Whisper server not ready' };
  }
  
  const tempDir = path.join(getBasePath(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  let tempFile;
  try {
    const matches = audioDataUrl.match(/^data:audio\/([^;,]+)(?:;[^,]+)*;base64,(.+)$/);
    if (!matches) {
      return { ok: false, error: 'Invalid audio data URL' };
    }
    
    const audioMimeSubtype = matches[1];
    const audioBase64 = matches[2];
    const ext = audioMimeSubtype === 'wav' ? '.wav' : `.${audioMimeSubtype.split(';')[0]}`;
    const mimeType = `audio/${audioMimeSubtype}`;
    tempFile = path.join(tempDir, `whisper_input_${Date.now()}${ext}`);
    
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    fs.writeFileSync(tempFile, audioBuffer);
    
    const text = await transcribeWithWhisper(tempFile, mimeType);
    return { ok: true, text };
  } catch (err) {
    console.error('[Pathey Whisper] Transcription error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (_) {}
  }
});

ipcMain.handle('whisper-status', async () => {
  return { ready: whisperReady, port: whisperPort };
});

ipcMain.handle('start-whisper', async () => {
  startWhisperServer();
  return { ok: true };
});

ipcMain.handle('stop-whisper', async () => {
  stopWhisperServer();
  return { ok: true };
});
