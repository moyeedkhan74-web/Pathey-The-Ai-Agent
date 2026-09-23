const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { isPathAllowed, withTimeout, requiresConfirmation } = require('../tools/safety');
const { logActivity } = require('../memory');

async function runCommand(args = {}) {
  const cmd = args.cmd;
  if (!cmd) return 'No command provided.';
  logActivity('run_command', cmd);
  return withTimeout(Promise.resolve().then(() => {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
        const result = (stdout || stderr || (error ? error.message : 'Command completed with no output.')).trim();
        resolve(result);
      });
    });
  }).catch(err => `Error: ${err.message}`));
}

module.exports = {
  runCommand
};
