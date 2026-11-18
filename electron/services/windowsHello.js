'use strict';

const { spawn } = require('child_process');
const path = require('path');

function scriptPath() {
  return path.join(__dirname, '..', 'scripts', 'windowsHello.ps1').replace('app.asar', 'app.asar.unpacked');
}

function run(mode) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, message: 'Credential reveal requires Windows Hello.' });
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), '-Mode', mode], { windowsHide: true, shell: false });
    let output = '';
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, message: 'Windows Hello verification timed out.' }); }, 90000);
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => { clearTimeout(timer); finish({ ok: false, message: error.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = output.trim();
      finish({ ok: code === 0 && (mode === 'availability' ? result === 'Available' : result === 'Verified'), message: result || 'Windows Hello verification failed.' });
    });
  });
}

module.exports = { availability: () => run('availability'), verify: () => run('verify') };
