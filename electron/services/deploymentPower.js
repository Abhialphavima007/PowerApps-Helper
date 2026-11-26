'use strict';

// One blocker protects overlapping manual operations and the whole agent run,
// including time spent waiting for approval. The display may still turn off.
function createDeploymentPower(powerSaveBlocker) {
  let active = 0;
  let blocker;
  async function run(operation) {
    if (active === 0) blocker = powerSaveBlocker.start('prevent-app-suspension');
    active++;
    try { return await operation(); }
    finally {
      active--;
      if (active === 0) {
        const id = blocker;
        blocker = undefined;
        if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);
      }
    }
  }
  return { run };
}
module.exports = { createDeploymentPower };
