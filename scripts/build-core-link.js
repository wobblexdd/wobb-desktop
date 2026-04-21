const fs = require('node:fs');
const path = require('node:path');

function getPlatformFolder(platform = process.platform) {
  switch (platform) {
    case 'win32':
      return 'win32';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function getBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'vpn-client-engine.exe' : 'vpn-client-engine';
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const platformFolder = getPlatformFolder();
  const binaryName = getBinaryName();
  const binaryDir = path.join(projectRoot, 'bin', platformFolder);
  const binaryPath = path.join(binaryDir, binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.error(`[build:core-link] Missing desktop core: ${binaryPath}`);
    console.error('[build:core-link] Expected local payload:');
    console.error(`[build:core-link]   ${binaryPath}`);
    if (platformFolder === 'win32') {
      console.error(`[build:core-link]   ${path.join(binaryDir, 'geoip.dat')}`);
      console.error(`[build:core-link]   ${path.join(binaryDir, 'geosite.dat')}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[build:core-link] Desktop core detected: ${binaryPath}`);
}

main();
