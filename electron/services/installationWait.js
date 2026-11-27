'use strict';

// v1.1.0 — background installation budget starts when blocking work is found.
const MAX_WAIT_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 1000;

function isInstallationBusy(message) {
  const text = String(message || '');
  // Retry only a rejected concurrent solution operation, never a generic failure.
  return /cannot start another[\s\S]*previous[\s\S]*(?:RibbonData|Import|Uninstall|Publish)[\s\S]*running/i.test(text) ||
    /(?:solution import|ribbon(?:data)? (?:installation|import)) (?:is already|is currently|is) (?:running|in progress)/i.test(text);
}

async function waitForInstallation({ readActive, report = () => {}, settle = false,
  deadline, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let idleChecks = 0;
  // Own-solution import time belongs to importOnce, never this 15-minute wait.
  // A caller may supply a shared deadline for rejected concurrent submissions.
  let waitDeadline = deadline;
  while (waitDeadline === undefined || now() < waitDeadline) {
    try {
      const active = await readActive(waitDeadline === undefined ? 30000 : Math.min(30000, waitDeadline - now()));
      if (waitDeadline !== undefined && now() >= waitDeadline) break;
      if (!active.length) {
        idleChecks++;
        if (idleChecks >= (settle ? 2 : 1)) return;
        report('Import completed. Checking for Microsoft background solution/RibbonData installation…');
      } else {
        waitDeadline ??= now() + MAX_WAIT_MS;
        idleChecks = 0;
        const names = [...new Set(active.map(item => item.solutionname || 'background installation'))].join(', ');
        report(`Waiting for Microsoft background installation: ${names}. Checking again in 10 seconds (maximum 15 minutes). This solution's import is tracked separately…`);
      }
    } catch (error) {
      idleChecks = 0;
      // Authorization/schema errors must not be mistaken for an idle environment.
      if (![429, 502, 503, 504].includes(error.status) &&
          !['TimeoutError', 'AbortError'].includes(error.name) && error.message !== 'fetch failed') throw error;
      waitDeadline ??= now() + MAX_WAIT_MS;
      report('Installation status is temporarily unavailable. Checking again in 10 seconds…');
    }
    await sleep(waitDeadline === undefined ? CHECK_INTERVAL_MS : Math.min(CHECK_INTERVAL_MS, Math.max(0, waitDeadline - now())));
  }
  const error = new Error('Microsoft solution/ribbon installation did not become ready within 15 minutes. Deployment stopped; remaining solutions were not started.');
  error.phase = 'installation';
  throw error;
}

module.exports = { MAX_WAIT_MS, CHECK_INTERVAL_MS, isInstallationBusy, waitForInstallation };
