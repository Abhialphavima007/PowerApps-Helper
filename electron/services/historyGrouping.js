'use strict';

// v1.0.1 — additive saved-package identity on queues and child records.
const queueHistoryId = queueId => 'queue_' + queueId;

function groupHistory(deployments, queues = []) {
  const groups = new Map();
  const entries = [];
  for (const queue of queues) groups.set(queue.queueId, { queue, records: [] });
  for (const record of deployments) {
    if (!record.queueId) { entries.push(record); continue; }
    if (!groups.has(record.queueId)) groups.set(record.queueId, { records: [] });
    groups.get(record.queueId).records.push(record);
  }
  for (const [queueId, { queue, records }] of groups) {
    records.sort((a, b) => (a.queueIndex ?? 0) - (b.queueIndex ?? 0));
    const first = queue || records[0];
    const count = Math.max(queue?.items?.length || 0, records.length,
      ...records.map(record => Number.isSafeInteger(record.queueCount) ? record.queueCount : 0),
      ...records.map(record => Number.isSafeInteger(record.queueIndex) ? record.queueIndex + 1 : 0));
    const byIndex = new Map(records.filter(item => Number.isSafeInteger(item.queueIndex)).map(item => [item.queueIndex, item]));
    const unindexed = records.filter(item => !Number.isSafeInteger(item.queueIndex));
    const solutions = Array.from({ length: count }, (_, index) => {
      const planned = queue?.items?.[index];
      const record = byIndex.get(index) || unindexed.shift();
      return {
        sourceEnv: first.sourceEnv, sourceUrl: first.sourceUrl,
        targetEnv: first.targetEnv, targetUrl: first.targetUrl, account: first.account,
        deploymentMethod: first.deploymentMethod, exportManaged: first.exportManaged,
        notes: first.notes, description: first.description, workItems: first.workItems,
        package: first.package,
        solution: 'Solution ' + (index + 1), version: '', status: 'unrecorded',
        ...planned, ...record, queueId, queueIndex: index, queueCount: count,
        warning: [...new Set([planned?.warning, record?.warning].filter(Boolean))].join(' '),
        // A planned timestamp must not pretend that an unstarted import ran.
        createdAt: record?.createdAt || planned?.startedAt || null,
        historyRecorded: !!record
      };
    });
    const completed = solutions.filter(item => item.status === 'success').length;
    const failed = solutions.filter(item => item.status === 'failed').length;
    const skipped = solutions.filter(item => item.status === 'skipped').length;
    const status = queue?.status === 'failed' || failed ? 'failed'
      : completed === count ? 'success' : 'pending';
    const types = new Set(solutions.map(item => item.exportManaged));
    entries.push({
      id: queueHistoryId(queueId), kind: 'queue', queueId,
      createdAt: queue?.createdAt || records.reduce((earliest, item) => item.createdAt < earliest ? item.createdAt : earliest, records[0].createdAt),
      finishedAt: queue?.finishedAt, solution: first.package?.name || 'Multiple solutions', version: '',
      package: first.package,
      sourceEnv: first.sourceEnv, sourceUrl: first.sourceUrl,
      targetEnv: first.targetEnv, targetUrl: first.targetUrl, account: first.account,
      deploymentMethod: first.deploymentMethod, exportManaged: first.exportManaged,
      mixedTypes: types.size > 1, status, queueCount: count, completed, failed, skipped,
      error: queue?.error || solutions.find(item => item.error)?.error,
      warning: queue?.warning, workItems: first.workItems,
      solutions
    });
  }
  return entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { groupHistory, queueHistoryId };
