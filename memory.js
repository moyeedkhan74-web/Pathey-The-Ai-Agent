// memory.js — Portable SQLite logs + markdown memory + FTS5 search for Pathey

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
        return {
          run() {},
          all() { return []; },
          get() { return {}; }
        };
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
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT NOT NULL UNIQUE,
      mime_type TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      FOREIGN KEY (document_id) REFERENCES documents(id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      content,
      content=conversation_log,
      content_rowid=id,
      tokenize='porter unicode61'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title,
      content,
      source,
      tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS conversation_ai AFTER INSERT ON conversation_log BEGIN
      INSERT INTO conversation_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS conversation_ad AFTER DELETE ON conversation_log BEGIN
      INSERT INTO conversation_fts(conversation_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS conversation_au AFTER UPDATE ON conversation_log BEGIN
      INSERT INTO conversation_fts(conversation_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO conversation_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO knowledge_fts(rowid, title, content, source)
      SELECT new.id, d.title, new.content, d.source
      FROM documents d
      WHERE d.id = new.document_id;
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, source)
      VALUES ('delete', old.id, '', old.content, '');
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, source)
      VALUES ('delete', old.id, '', old.content, '');
      INSERT INTO knowledge_fts(rowid, title, content, source)
      SELECT new.id, d.title, new.content, d.source
      FROM documents d
      WHERE d.id = new.document_id;
    END;
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
    const db = getDb();
    const stmt = db.prepare('INSERT INTO conversation_log (role, content, timestamp) VALUES (?, ?, ?)');
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

function chunkText(text, chunkSize = 500, overlap = 100) {
  const chunks = [];
  const words = text.split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks.filter(Boolean);
}

async function indexKnowledgeFiles() {
  const knowledgeDir = getKnowledgeDir();
  if (!fs.existsSync(knowledgeDir)) return;
  const db = getDb();
  const insertDocument = db.prepare(`
    INSERT OR IGNORE INTO documents (title, source, mime_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (document_id, chunk_index, content, token_count)
    VALUES (?, ?, ?, ?)
  `);

  try {
    const files = fs.readdirSync(knowledgeDir);
    for (const file of files) {
      const fullPath = path.join(knowledgeDir, file);
      const ext = path.extname(file).toLowerCase();
      let text = '';
      let mimeType = 'text/plain';
      if (ext === '.pdf') {
        const buffer = fs.readFileSync(fullPath);
        text = await extractPdfText(buffer);
        mimeType = 'application/pdf';
      } else if (['.txt', '.md', '.json', '.slang'].includes(ext)) {
        text = fs.readFileSync(fullPath, 'utf-8');
      }
      if (!text.trim()) continue;
      const now = new Date().toISOString();
      insertDocument.run(file, `knowledge/${file}`, mimeType, now, now);
      const docId = db.prepare('SELECT id FROM documents WHERE source = ?').get(`knowledge/${file}`).id;
      const chunks = chunkText(text);
      chunks.forEach((chunk, idx) => {
        insertChunk.run(docId, idx, chunk, chunk.split(/\s+/).length);
      });
    }
  } catch (err) {
    console.warn('Knowledge indexing error:', err.message);
  }
}

async function searchRelevantChunks(query, limit = 5) {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      SELECT c.id, c.document_id, c.chunk_index, c.content, c.token_count,
             d.title, d.source,
             bm25(knowledge_fts) as score
      FROM knowledge_fts
      JOIN chunks c ON c.id = knowledge_fts.rowid
      JOIN documents d ON d.id = c.document_id
      WHERE knowledge_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);
    const results = stmt.all(query, limit);
    return results.map(r => ({
      title: r.title,
      source: r.source,
      content: r.content,
      score: r.score,
      token_count: r.token_count
    }));
  } catch (err) {
    console.warn('[Pathey Memory] FTS search failed:', err.message);
    return [];
  }
}

async function searchConversation(query, limit = 5) {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      SELECT id, role, content, timestamp,
             bm25(conversation_fts) as score
      FROM conversation_fts
      WHERE conversation_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);
    const results = stmt.all(query, limit);
    return results.map(r => ({
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
      score: r.score
    }));
  } catch (err) {
    console.warn('[Pathey Memory] Conversation search failed:', err.message);
    return [];
  }
}

async function addKnowledgeNote(title, content) {
  const db = getDb();
  const insertDocument = db.prepare(`
    INSERT INTO documents (title, source, mime_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const upsertDocument = db.prepare(`
    INSERT INTO documents (title, source, mime_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (document_id, chunk_index, content, token_count)
    VALUES (?, ?, ?, ?)
  `);
  const getDocId = db.prepare('SELECT id FROM documents WHERE source = ?');
  const now = new Date().toISOString();
  const source = 'manual';
  upsertDocument.run(title || 'Untitled', source, 'text/plain', now, now);
  const docRow = getDocId.get(source);
  const docId = docRow && docRow.id ? docRow.id : 1;
  const chunks = chunkText(content || '');
  chunks.forEach((chunk, idx) => {
    insertChunk.run(docId, idx, chunk, chunk.split(/\s+/).length);
  });
}

async function buildContextFromSearch(query, maxTokens = 2000) {
  const db = getDb();
  const results = await searchRelevantChunks(query, 10);
  if (!results.length) return '';

  let context = '';
  let totalTokens = 0;
  for (const r of results) {
    const tokens = r.token_count || r.content.split(/\s+/).length;
    if (totalTokens + tokens > maxTokens) break;
    context += `[${r.source}] ${r.content}\n\n`;
    totalTokens += tokens;
  }
  return context.trim();
}

async function readMemory() {
  const memoryPath = getMemoryFilePath();
  let baseMemory = '';
  if (fs.existsSync(memoryPath)) {
    try {
      baseMemory = fs.readFileSync(memoryPath, 'utf-8');
    } catch (_) {}
  }
  return baseMemory.trim();
}

async function getMemoryContext(query, maxTokens = 2000) {
  const memoryPath = getMemoryFilePath();
  let baseMemory = '';
  if (fs.existsSync(memoryPath)) {
    try {
      baseMemory = fs.readFileSync(memoryPath, 'utf-8');
    } catch (_) {}
  }
  const relevantChunks = await buildContextFromSearch(query, maxTokens);
  const parts = [baseMemory, relevantChunks].filter(Boolean);
  return parts.join('\n\n').trim();
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
  clearHistory,
  indexKnowledgeFiles,
  searchRelevantChunks,
  searchConversation,
  addKnowledgeNote,
  buildContextFromSearch,
  getMemoryContext
};
