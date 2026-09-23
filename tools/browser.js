const { shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { isPathAllowed, withTimeout, requiresConfirmation } = require('../tools/safety');
const { logActivity } = require('../memory');
const { normalizeUrl, isYouTubeWatchUrl, isGenericYouTubeUrl, isYouTubeVideoUnavailableHtml, searchYouTubeVideos, scoreYouTubeCandidate } = require('../browser_utils');

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
      return watchUrl;
    }
  }
  return fallbackUrl || null;
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
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.toLowerCase().endsWith('.exe') || entry.name.toLowerCase().endsWith('.lnk'))) {
          const entryName = entry.name.replace(/\.(exe|lnk)$/i, '').toLowerCase();
          if (entryName === target) return path.join(dir, entry.name);
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
    { dir: process.env.ProgramFiles || 'C:\\Program Files', maxDepth: 2 },
    { dir: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', maxDepth: 2 },
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

async function openUrl(args = {}) {
  let url = normalizeUrl(args.url || args.link || '');
  if (!url) return 'No URL provided.';
  // If URL is valid, prepare to open directly in browser
  const isYouTube = isYouTubeWatchUrl(url) || isGenericYouTubeUrl(url);
  if (isYouTubeWatchUrl(url)) {
    const playable = await isYouTubeWatchUrlPlayable(url);
    if (!playable) {
      if (args.searchQuery) {
        const resolved = await pickBestYouTubeVideo(args.searchQuery, null, args.channelFilter || '');
        if (resolved) url = resolved;
        else return `The video at ${url} is unavailable and I couldn't find a working version.`;
      } else {
        return `The video link ${url} is unavailable. Please give me the exact song name and artist.`;
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
    const resolved = searchQuery ? await pickBestYouTubeVideo(searchQuery, null, args.channelFilter || '') : null;
    if (resolved) url = resolved;
    else if (searchQuery) return `I couldn't auto-resolve a playable video for "${searchQuery}".`;
    else return 'Please provide a specific song or video to play.';
  }
  if (args.clipboard) {
    try { clipboard.writeText(args.clipboard); } catch (_) {}
  }
  logActivity('open_url', url);
  const triggerAutoSubmit = () => {
    if ((url.includes('chatgpt.com') || url.includes('claude.ai') || url.includes('gemini.google.com')) && args.clipboard) {
      const psCommand = `powershell.exe -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; Start-Sleep -Seconds 2.5; $wshell.SendKeys('^v'); Start-Sleep -Milliseconds 300; $wshell.SendKeys('{ENTER}')"`;
      require('child_process').exec(psCommand, (err) => { if (err) console.warn('[open_url] Auto-submit failed:', err.message); });
    }
  };
  if (args.browser) {
    const browserName = args.browser.trim().toLowerCase();
    const exeName = browserName.endsWith('.exe') ? browserName : `${browserName}.exe`;
    const browserPath = findWindowsApp(exeName);
    if (browserPath) {
      const child = spawn(browserPath, [url], { detached: true, stdio: 'ignore' });
      child.on('error', (spawnErr) => console.error(`[open_url] Failed to launch ${exeName}:`, spawnErr.message));
      child.unref();
      triggerAutoSubmit();
      return `Opened: ${url} in custom browser (${browserName})`;
    }
  }
  shell.openExternal(url).catch(() => {});
  triggerAutoSubmit();
  return `Opened: ${url}`;
}

async function openApp(args = {}) {
  const appName = args.name;
  if (!appName) return 'No app name provided.';
  logActivity('open_app', appName);
  const resolvedPath = findWindowsApp(appName);
  if (resolvedPath) {
    shell.openPath(resolvedPath).catch(() => {});
    return `Opened app: ${appName}`;
  }
  const child = spawn(appName, { detached: true, stdio: 'ignore' });
  child.on('error', (spawnErr) => console.error('[open_app] Spawn error:', spawnErr.message));
  child.unref();
  return `Opened app (spawn fallback): ${appName}`;
}

module.exports = {
  openUrl,
  openApp
};
