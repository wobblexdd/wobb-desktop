const { spawn } = require('node:child_process');

function main() {
  const electronBinary = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    env,
  });

  child.once('error', (error) => {
    console.error(`[electron] ${error.message}`);
    process.exit(1);
  });

  child.once('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main();
