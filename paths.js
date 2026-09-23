// paths.js — Portable path resolution for Pathey
const path = require('path');
const fs = require('fs');
function getBasePath() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.dirname(process.execPath);
    }
  } catch (_) {}
  return __dirname;
}
function loadEnv() {
  const envPath = path.join(getBasePath(), '.env');
  try {
    try {
      require('dotenv').config({ path: envPath });
    } catch (_) {}
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        const rawVal = trimmed.substring(eqIdx + 1);
        const val = rawVal.split(/\s+#/)[0].trim().replace(/^['"]|['"]$/g, '');
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch (err) {
    console.warn('Env load warning:', err.message);
  }
}
function getDataDir() {
  const dataDir = path.join(getBasePath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}
module.exports = { getBasePath, getDataDir, loadEnv };
