// scripts/ensure-electron.js
// Automatically verifies that node_modules/electron/dist/electron.exe exists and is complete (>100MB) after npm install.
// Also creates node_modules/.bin/electron.cmd so 'npm start' works seamlessly without npm binary download.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function ensureHelperFiles(electronDir, targetVer) {
  try {
    const rootDir = path.resolve(electronDir, '..', '..');
    const binDir = path.join(rootDir, 'node_modules', '.bin');

    // 1. Ensure path.txt
    const pathTxt = path.join(electronDir, 'path.txt');
    if (!fs.existsSync(pathTxt)) {
      fs.writeFileSync(pathTxt, 'electron.exe', 'utf8');
    }

    // 2. Ensure index.js
    const indexJs = path.join(electronDir, 'index.js');
    if (!fs.existsSync(indexJs)) {
      fs.writeFileSync(
        indexJs,
        'var fs = require("fs"); var path = require("path"); var pathFile = path.join(__dirname, "path.txt"); if (fs.existsSync(pathFile)) { var pathString = fs.readFileSync(pathFile, "utf-8"); module.exports = path.join(__dirname, "dist", pathString.trim()); } else { module.exports = path.join(__dirname, "dist", "electron.exe"); }',
        'utf8'
      );
    }

    // 3. Ensure package.json inside node_modules/electron
    const pkgJson = path.join(electronDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.writeFileSync(
        pkgJson,
        JSON.stringify({ name: 'electron', version: targetVer, main: 'index.js', bin: { electron: 'cli.js' } }, null, 2),
        'utf8'
      );
    }

    // 4. Ensure node_modules/electron/cli.js
    const cliJs = path.join(electronDir, 'cli.js');
    if (!fs.existsSync(cliJs)) {
      fs.writeFileSync(
        cliJs,
        '#!/usr/bin/env node\nvar spawn = require("child_process").spawn;\nvar electron = require("./index.js");\nvar proc = spawn(electron, process.argv.slice(2), { stdio: "inherit", windowsHide: false });\nproc.on("close", function (code) { process.exit(code); });\n',
        'utf8'
      );
    }

    // 5. Ensure node_modules/.bin/electron.cmd & node_modules/.bin/electron
    fs.mkdirSync(binDir, { recursive: true });
    const electronCmd = path.join(binDir, 'electron.cmd');
    const cmdContent = `@IF EXIST "%~dp0\\..\\electron\\dist\\electron.exe" (\n  "%~dp0\\..\\electron\\dist\\electron.exe" %*\n) ELSE (\n  node "%~dp0\\..\\electron\\cli.js" %*\n)\n`;
    fs.writeFileSync(electronCmd, cmdContent, 'utf8');

    const electronBash = path.join(binDir, 'electron');
    const bashContent = `#!/bin/sh\nexec "$basedir/../electron/dist/electron.exe" "$@"\n`;
    fs.writeFileSync(electronBash, bashContent, 'utf8');
  } catch (err) {
    console.warn('[ensure-electron] Helper creation warning:', err.message);
  }
}

function ensureElectron() {
  const rootDir = path.resolve(__dirname, '..');
  const electronDir = path.join(rootDir, 'node_modules', 'electron');
  const distDir = path.join(electronDir, 'dist');
  const exePath = path.join(distDir, 'electron.exe');

  // Read desired version from package.json if possible
  let targetVer = '31.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const devDep = pkg.devDependencies && pkg.devDependencies.electron;
    if (devDep) {
      targetVer = devDep.replace(/[\^~>=]/g, '');
    }
  } catch (_) {}

  // Verify electron.exe exists AND is full size (>100MB)
  if (fs.existsSync(exePath)) {
    const stat = fs.statSync(exePath);
    if (stat.size > 100000000) {
      console.log(`[ensure-electron] electron.exe is present and valid (${stat.size} bytes).`);
      ensureHelperFiles(electronDir, targetVer);
      return;
    } else {
      console.warn(`[ensure-electron] electron.exe is truncated (${stat.size} bytes, expected ~180MB). Re-extracting...`);
    }
  } else {
    console.log('[ensure-electron] electron.exe missing in node_modules/electron/dist. Searching local cache...');
  }

  // Search %LOCALAPPDATA%\electron\Cache for matching zip file
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheDir = path.join(localAppData, 'electron', 'Cache');

  let zipPath = null;
  if (fs.existsSync(cacheDir)) {
    const findZips = (dir) => {
      let found = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            found = found.concat(findZips(full));
          } else if (entry.isFile() && entry.name.endsWith('.zip')) {
            found.push({ full, name: entry.name });
          }
        }
      } catch (_) {}
      return found;
    };

    const zips = findZips(cacheDir);
    const exactMatch = zips.find(z => z.name.includes(`v${targetVer}`));
    if (exactMatch) {
      zipPath = exactMatch.full;
    } else {
      const electronZip = zips.find(z => z.name.startsWith('electron-v'));
      if (electronZip) {
        zipPath = electronZip.full;
      }
    }
  }

  if (!zipPath) {
    console.warn('[ensure-electron] Warning: Could not find cached Electron zip in ' + cacheDir);
    ensureHelperFiles(electronDir, targetVer);
    return;
  }

  console.log(`[ensure-electron] Found cached Electron zip: ${zipPath}`);

  // Stage extraction in %TEMP% on fast local disk first, then sync to USB drive
  const tempStageDir = path.join(os.tmpdir(), 'pathey_electron_stage');
  try {
    fs.mkdirSync(tempStageDir, { recursive: true });
  } catch (_) {}

  const tarZip = zipPath.replace(/\\/g, '/');
  const tarStage = tempStageDir.replace(/\\/g, '/');

  console.log(`[ensure-electron] Extracting to local stage (${tempStageDir})...`);
  try {
    execSync(`tar -xf "${tarZip}" -C "${tarStage}"`, { stdio: 'ignore' });
  } catch (_) {}

  fs.mkdirSync(distDir, { recursive: true });

  console.log(`[ensure-electron] Syncing binary files to ${distDir}...`);
  try {
    execSync(`robocopy "${tempStageDir}" "${distDir}" /MIR /NFL /NDL /NJH /NJS`, { stdio: 'ignore' });
  } catch (_) {}

  ensureHelperFiles(electronDir, targetVer);

  if (fs.existsSync(exePath) && fs.statSync(exePath).size > 100000000) {
    const finalSize = fs.statSync(exePath).size;
    console.log(`[ensure-electron] Successfully unpacked electron.exe (${finalSize} bytes)!`);
  } else {
    console.error('[ensure-electron] Failed to unpack electron.exe to ' + exePath);
  }
}

if (require.main === module) {
  ensureElectron();
}

module.exports = { ensureElectron };
