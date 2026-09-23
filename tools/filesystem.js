const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { isPathAllowed, withTimeout } = require('../tools/safety');
const { logActivity } = require('../memory');

async function listDirectory(args = {}) {
  const target = args.path || '.';
  if (!isPathAllowed(target)) {
    return 'Error: Access to this path is restricted.';
  }
  return withTimeout(Promise.resolve().then(() => {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return JSON.stringify(entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })), null, 2);
  }).catch(err => `Error: ${err.message}`));
}

async function readFile(args = {}) {
  const target = args.path;
  if (!target) return 'No path provided.';
  if (!isPathAllowed(target)) {
    return 'Error: Access to this path is restricted.';
  }
  logActivity('read_file', target);
  return withTimeout(Promise.resolve().then(() => {
    return fs.readFileSync(target, 'utf8');
  }).catch(err => `Error: ${err.message}`));
}

async function writeFile(args = {}) {
  const target = args.path;
  const content = args.content;
  if (!target) return 'No path provided.';
  if (!isPathAllowed(target)) {
    return 'Error: Access to this path is restricted.';
  }
  logActivity('write_file', target);
  return withTimeout(Promise.resolve().then(() => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content || '', 'utf8');
    return `Wrote file: ${target}`;
  }).catch(err => `Error: ${err.message}`));
}

async function gitStatus(args = {}) {
  const target = args.path || '.';
  if (!isPathAllowed(target)) {
    return 'Error: Access to this path is restricted.';
  }
  logActivity('git_status', target);
  return withTimeout(Promise.resolve().then(() => {
    return new Promise((resolve, reject) => {
      exec('git status --short', { cwd: target }, (error, stdout, stderr) => {
        if (error && !stdout && !stderr) return reject(error);
        resolve((stdout || stderr || '').trim() || 'No git status output.');
      });
    });
  }).catch(err => `Error: ${err.message}`));
}

module.exports = {
  listDirectory,
  readFile,
  writeFile,
  gitStatus
};
