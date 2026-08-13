'use strict';
// Optional git integration: init a repo, commit the exported solution zip and
// generated deployment notes so releases are versioned locally.

const { spawn } = require('child_process');

function git(args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('git', args, { cwd, shell: process.platform === 'win32' });
    } catch (err) {
      return resolve({ ok: false, stdout: '', stderr: String(err) });
    }
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ ok: false, stdout, stderr: stderr + String(err) }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

async function isRepo(cwd) {
  const r = await git(['rev-parse', '--is-inside-work-tree'], cwd);
  return r.ok && r.stdout.trim() === 'true';
}

async function ensureRepo(cwd) {
  if (await isRepo(cwd)) return { ok: true, created: false };
  const r = await git(['init'], cwd);
  return { ok: r.ok, created: true, raw: r.stdout + r.stderr };
}

async function commitAll(cwd, message) {
  await git(['add', '-A'], cwd);
  const r = await git(['commit', '-m', message], cwd);
  return { ok: r.ok, raw: r.stdout + r.stderr };
}

async function status(cwd) {
  const r = await git(['status', '--short'], cwd);
  return { ok: r.ok, raw: r.stdout, dirty: r.stdout.trim().length > 0 };
}

module.exports = { git, isRepo, ensureRepo, commitAll, status };
