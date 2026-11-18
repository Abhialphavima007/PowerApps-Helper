const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === './credentials' && parent?.filename.endsWith('ai.js')) return { get: (provider) => ['openai', 'foundry'].includes(provider) ? 'api-key' : '' };
  if (name === './store' && parent?.filename.endsWith('ai.js')) return { getSettings: () => ({ azureFoundryEndpoint: 'https://example.services.ai.azure.com/models', aiModels: { openai: 'gpt-4.1-mini', foundry: 'model-deployment' } }) };
  return originalLoad.call(this, name, parent, isMain);
};
const ai = require('../electron/services/ai');
Module._load = originalLoad;

test('writes a separate plain-English problem, task journey, and outcome for each story', async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer api-key');
    const prompt = JSON.parse(options.body).input[1].content;
    prompts.push(prompt);
    const second = prompt.includes('Story AB#10:');
    return { ok: true, text: async () => JSON.stringify({ output_text: JSON.stringify(second
      ? { problem: 'The service job lacked a usable reference.', work: '**Task AB#11** added the reference to charges and invoices.', outcome: 'Task AB#11 is Closed, while the parent story remains Active; deployment is not confirmed.' }
      : { problem: 'Transport documents showed a billing address instead of the jobsite.', work: 'Task AB#2 mapped the reservation address and a reviewer confirmed the change.', outcome: 'The story and its task are Closed; the record does not confirm deployment.' }) }) };
  };
  try {
    const progress = [];
    const result = await ai.summarizeWorkItems({ provider: 'openai', workItemDetails: { rootIds: [1, 10], items: [
      { id: 1, rootId: 1, type: 'User Story', state: 'Closed', title: 'Transport address', description: 'Documents use billing address.' },
      { id: 2, rootId: 1, type: 'Task', state: 'Closed', parentId: 1, title: 'Map jobsite address', description: 'Read reservation jobsite address.', changedAt: '2026-11-15T10:00:00Z', comments: [{ text: 'Reviewer confirmed the mapping.' }] },
      { id: 10, rootId: 10, type: 'User Story', state: 'Active', title: 'Service reference', description: 'Service charges need a job reference.' },
      { id: 11, rootId: 10, type: 'Task', state: 'Closed', parentId: 10, title: 'Add reference', description: 'Add reference to charges and invoices.' }
    ] } }, (step) => progress.push(step));
    assert.match(prompts[0], /Read reservation jobsite address/);
    assert.match(prompts[0], /Reviewer confirmed the mapping/);
    assert.match(prompts[0], /2026-11-15T10:00:00Z/);
    assert.match(prompts[1], /Parent story state: Active/);
    assert.match(prompts[1], /A Closed state does not by itself prove deployment/);
    assert.match(result.summary, /Story AB#1: Transport address[\s\S]*Problem: Transport documents/);
    assert.match(result.summary, /Story AB#10: Service reference[\s\S]*Story status: Active/);
    assert.match(result.summary, /How it was addressed and tracked: Task AB#11 added/);
    assert.doesNotMatch(result.summary, /\*\*|Here's a summary|Acceptance Criteria:/);
    assert.equal(progress.at(-1).stage, 'done');
    assert.equal(progress.at(-1).completed, progress.at(-1).total);
  } finally { global.fetch = originalFetch; }
});

test('keeps a large story together and retries an unusable AI response', async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://example.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    assert.equal(options.headers['api-key'], 'api-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'model-deployment');
    const prompt = body.messages[1].content;
    prompts.push(prompt);
    const output = prompt.includes('Extract factual evidence') ? 'Task AB#21 records address mapping; story remains Active.'
      : prompt.includes('Return valid JSON with only') ? JSON.stringify({ problem: 'Documents used the wrong address.', work: 'Task AB#21 mapped the jobsite address.', outcome: 'The story remains Active; release is unverified.' })
        : 'Here is a long Markdown list instead.';
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: output } }] }) };
  };
  try {
    assert.throws(() => ai.foundryUrl('https://example.com', 'model-deployment'), /hosted on Azure/);
    assert.equal(ai.foundryUrl('https://example.openai.azure.com/openai/v1/', 'model-deployment'), 'https://example.openai.azure.com/openai/v1/chat/completions');
    const result = await ai.summarizeWorkItems({ provider: 'foundry', workItemDetails: { rootIds: [20], items: [
      { id: 20, rootId: 20, type: 'User Story', title: 'Transport address', state: 'Active', description: 'x'.repeat(90000) },
      { id: 21, rootId: 20, parentId: 20, type: 'Task', state: 'Closed', title: 'Address mapping' }
    ] } });
    assert(prompts.filter((prompt) => prompt.includes('Extract factual evidence')).length > 1);
    assert(prompts.some((prompt) => prompt.includes('Condensed evidence from all work item parts')));
    assert.match(result.summary, /Problem: Documents used the wrong address/);
    assert.doesNotMatch(result.summary, /Here is a long Markdown list/);
  } finally { global.fetch = originalFetch; }
});
