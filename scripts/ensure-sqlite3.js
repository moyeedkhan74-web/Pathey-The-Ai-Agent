// scripts/ensure-sqlite3.js
// Ensures better-sqlite3's native binary matches the installed Electron ABI.
// Prefers the official prebuilt binary (no compiler needed); falls back to
// an electron-rebuild source build (requires Visual Studio C++ toolchain).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const bs3Dir = path.join(rootDir, 'node_modules', 'better-sqlite3');
const binaryPath = path.join(bs3Dir, 'build', 'Release', 'better_sqlite3.node');

function getElectronVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8'));
    return pkg.version;
  } catch (_) {
    return null;
  }
}

function main() {
  if (!fs.existsSync(path.join(bs3Dir, 'package.json'))) {
    console.warn('[ensure-sqlite3] better-sqlite3 not installed; skipping.');
    return;
  }

  if (fs.existsSync(binaryPath)) {
    console.log('[ensure-sqlite3] better_sqlite3.node already present.');
    return;
  }

  const target = getElectronVersion();
  if (target) {
    try {
      execSync(`npx --no-install prebuild-install --runtime electron --target ${target}`, {
        stdio: 'inherit',
        cwd: bs3Dir
      });
      if (fs.existsSync(binaryPath)) {
        console.log(`[ensure-sqlite3] Installed official Electron ${target} prebuilt for better-sqlite3.`);
        return;
      }
    } catch (err) {
      console.warn('[ensure-sqlite3] prebuild-install failed:', err.message);
    }
  }

  try {
    execSync('npx --no-install electron-rebuild -f -w better-sqlite3', {
      stdio: 'inherit',
      cwd: rootDir
    });
    console.log('[ensure-sqlite3] Rebuilt better-sqlite3 for Electron via electron-rebuild.');
    return;
  } catch (err) {
    console.warn('[ensure-sqlite3] electron-rebuild failed:', err.message);
  }

  console.warn('[ensure-sqlite3] Could not prepare better-sqlite3. Pathey will use the file-only memory fallback.');
}

main();
