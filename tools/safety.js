const path = require('path');
const fs = require('fs');

const FORBIDDEN_PATHS = [
  process.env.USERPROFILE || '',
  process.env.APPDATA || '',
  process.env.LOCALAPPDATA || '',
  process.env.ProgramData || 'C:\\ProgramData',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  path.join(process.env.USERPROFILE || '', '.ssh'),
  path.join(process.env.USERPROFILE || '', '.env'),
  path.join(process.env.USERPROFILE || '', '.npmrc'),
  path.join(process.env.USERPROFILE || '', '.gitconfig'),
].filter(Boolean);

function isPathAllowed(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const resolved = path.resolve(targetPath);
  const base = path.resolve(process.cwd());
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return false;
  }
  for (const forbidden of FORBIDDEN_PATHS) {
    const fb = path.resolve(forbidden);
    if (resolved === fb || resolved.startsWith(fb + path.sep)) {
      return false;
    }
  }
  return true;
}

function requiresConfirmation(toolName) {
  const DANGEROUS = new Set(['run_command', 'write_file']);
  return DANGEROUS.has(toolName);
}

async function withTimeout(promise, ms = 10000) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Tool execution timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  isPathAllowed,
  requiresConfirmation,
  withTimeout
};
