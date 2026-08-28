// memory.js — Portable SQLite logs + markdown memory for Pathey

const path = require('path');
const fs = require('fs');
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.warn('[Pathey Memory] better-sqlite3 unavailable, using file-only memory fallback:', err.message);
}
const { getBasePath, getDataDir } = require('./paths');

let db = null;

function getDb() {
  if (db) return db;
  if (!Database) {
    db = {
      pragma() {},
      exec() {},
      prepare() {
        return { run() {}, all() { return []; } };
      }
    };
    return db;
  }
  const dbPath = path.join(getDataDir(), 'pathey.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  return db;
}

function getMemoryFilePath() {
  return path.join(getDataDir(), 'pathey-memory.md');
}

function getKnowledgeDir() {
  const dir = path.join(getBasePath(), 'knowledge');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
  return dir;
}

function extractRememberText(message) {
  if (!message || typeof message !== 'string') return null;
  const match = message.match(/^(?:remember\s+(?:that\s+)?|yaad\s+rakh\s+)(.+)$/i);
  return match ? match[1].trim() : null;
}

// Detects: "my <project> (repo|link|github|url|website|site) is <url>"
function extractProjectLink(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/my\s+(.+?)\s+(?:repo|link|github|url|website|site|project)\s+is\s+(https?:\/\/[^\s]+)/i);
  if (!m) return null;
  const projectName = m[1].trim();
  const url = m[2].trim().replace(/\.+$/, '');
  if (!projectName || !url) return null;
  return { projectName, url };
}

function findProjectLink(projectName) {
  if (!projectName || typeof projectName !== 'string') return null;
  const filePath = getMemoryFilePath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    let inProjectsSection = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '## Projects') {
        inProjectsSection = true;
        continue;
      }
      if (inProjectsSection && trimmed.startsWith('## ')) {
        break;
      }
      if (!inProjectsSection || !trimmed.startsWith('- ')) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const storedName = trimmed.slice(2, colonIdx).trim();
      if (storedName.toLowerCase() === projectName.trim().toLowerCase()) {
        return trimmed.slice(colonIdx + 1).trim();
      }
    }
  } catch (_) {}

  return null;
}

// Upserts a project link into ## Projects section of pathey-memory.md
function appendProjectLink(projectName, url) {
  const filePath = getMemoryFilePath();
  const entryLine = `- ${projectName}: ${url}`;
  const nameLower = projectName.toLowerCase();
  const projectsHeading = '## Projects';

  let content = '';
  if (fs.existsSync(filePath)) {
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch (_) {}
  } else {
    content = '# Pathey Memory\n\nThings I know about you:\n\n';
  }

  if (content.includes(projectsHeading)) {
    const lines = content.split('\n');
    let inSection = false;
    let updated = false;
    const newLines = lines.map(line => {
      if (line.trim() === projectsHeading) { inSection = true; return line; }
      if (inSection && line.startsWith('## ') && line.trim() !== projectsHeading) inSection = false;
      if (inSection && line.startsWith('- ')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1 && line.slice(2, colonIdx).trim().toLowerCase() === nameLower) {
          updated = true;
          return entryLine;
        }
      }
      return line;
    });
    if (updated) { fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8'); return; }
    // Not found — insert right after the heading
    const headIdx = newLines.findIndex(l => l.trim() === projectsHeading);
    newLines.splice(headIdx + 1, 0, entryLine);
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8');
  } else {
    const suffix = content.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(filePath, `${content}${suffix}\n${projectsHeading}\n${entryLine}\n`, 'utf-8');
  }
}

function saveMemory(userMsg, aiMsg) {
  try {
    const now = new Date().toISOString();
    const stmt = getDb().prepare('INSERT INTO conversation_log (role, content, timestamp) VALUES (?, ?, ?)');
    stmt.run('user', userMsg, now);
    stmt.run('assistant', aiMsg, now);
  } catch (err) {
    console.warn('[Pathey Memory] Error saving conversation:', err.message);
  }
}

function logActivity(action, details) {
  try {
    const now = new Date().toISOString();
    const stmt = getDb().prepare('INSERT INTO activity_log (action, details, timestamp) VALUES (?, ?, ?)');
    stmt.run(action, typeof details === 'string' ? details : JSON.stringify(details), now);
  } catch (err) {
    console.warn('[Pathey Memory] Error logging activity:', err.message);
  }
}

function appendMemory(text) {
  const filePath = getMemoryFilePath();
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '# Pathey Memory\n\nThings I know about you:\n\n', 'utf-8');
  }

  fs.appendFileSync(filePath, `- ${trimmed}\n`, 'utf-8');
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return String(data.text || '').slice(0, 5000);
  } catch (_) {
    return '';
  }
}

async function readKnowledgeFiles() {
  const knowledgeDir = getKnowledgeDir();
  if (!fs.existsSync(knowledgeDir)) return '';

  let knowledgeContent = '';
  try {
    const files = fs.readdirSync(knowledgeDir);
    for (const file of files) {
      const fullPath = path.join(knowledgeDir, file);
      const ext = path.extname(file).toLowerCase();

      if (ext === '.pdf') {
        const buffer = fs.readFileSync(fullPath);
        const extracted = await extractPdfText(buffer);
        if (extracted) {
          knowledgeContent += `\n--- Knowledge from PDF [${file}] ---\n${extracted}\n`;
        }
      } else if (['.txt', '.md', '.json', '.slang'].includes(ext)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.trim()) {
          knowledgeContent += `\n--- Knowledge from document [${file}] ---\n${content.trim()}\n`;
        }
      }
    }
  } catch (err) {
    console.warn('Knowledge dir read error:', err.message);
  }

  return knowledgeContent;
}

async function readMemory() {
  const memoryPath = getMemoryFilePath();
  let baseMemory = '';
  if (fs.existsSync(memoryPath)) {
    try {
      baseMemory = fs.readFileSync(memoryPath, 'utf-8');
    } catch (_) {}
  }
  const knowledge = await readKnowledgeFiles();
  return (baseMemory + (knowledge ? '\n\n' + knowledge : '')).trim();
}

function clearHistory() {
  try {
    getDb().exec('DELETE FROM conversation_log;');
    getDb().exec('DELETE FROM activity_log;');
  } catch (_) {}
}

module.exports = {
  getDb,
  getMemoryFilePath,
  extractRememberText,
  extractProjectLink,
  findProjectLink,
  appendProjectLink,
  saveMemory,
  logActivity,
  appendMemory,
  readMemory,
  clearHistory
};
