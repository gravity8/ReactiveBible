// Starts Vite on any available port, then launches Electron with the URL.
const { spawn } = require('child_process');
const path = require('path');

const vite = spawn('npx', ['vite'], { cwd: __dirname, shell: true, stdio: ['pipe', 'pipe', 'inherit'] });

let launched = false;

vite.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  if (launched) return;

  // Vite prints "Local: http://localhost:XXXX/"
  const match = text.match(/Local:\s+(https?:\/\/[^\s]+)/);
  if (match) {
    launched = true;
    const url = match[1].replace(/\/$/, '');
    console.log(`[dev] Vite ready at ${url} — launching Electron...`);

    const electron = spawn('npx', ['electron', '.'], {
      cwd: __dirname,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_SERVER_URL: url },
    });

    electron.on('close', () => {
      vite.kill();
      process.exit(0);
    });
  }
});

vite.on('close', (code) => process.exit(code));
