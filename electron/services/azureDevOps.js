'use strict';

const credentials = require('./credentials');
const store = require('./store');

function organizationUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter an Azure DevOps organization URL in Settings.'); }
  if (url.protocol !== 'https:') throw new Error('Azure DevOps organization URL must use HTTPS.');
  if (url.hostname === 'dev.azure.com') {
    const org = url.pathname.split('/').filter(Boolean)[0];
    if (!org) throw new Error('Use an organization URL such as https://dev.azure.com/your-org.');
    return `https://dev.azure.com/${encodeURIComponent(org)}`;
  }
  if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname)) return `https://${url.hostname}`;
  throw new Error('Use a dev.azure.com or visualstudio.com organization URL.');
}

function parseIds(value) {
  const out = [];
  for (const token of String(value || '').split(/[,;\s]+/)) {
    const text = token.trim();
    if (!text) continue;
    const numeric = text.match(/^(?:AB#|#)?(\d+)$/i);
    let match = numeric;
    if (!match) {
      try {
        const url = new URL(text);
        match = url.pathname.match(/\/(?:_workitems\/edit|_apis\/wit\/workitems)\/(\d+)\/?$/i);
      } catch {}
    }
    if (!match) throw new Error(`Invalid Azure DevOps work item reference: ${text.slice(0, 80)}. Separate IDs with commas.`);
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Invalid Azure DevOps work item ID: ${text.slice(0, 80)}.`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function plainText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (match, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : match)
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => parseInt(code, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(code, 16)) : match)
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function request(url, token, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + token).toString('base64')}`, Accept: 'application/json' },
      signal: controller.signal
    });
    const body = await response.text();
    if ([429, 503].includes(response.status) && attempt < 2) {
      const retryAfter = Number(response.headers?.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1000)));
      return request(url, token, attempt + 1);
    }
    if (!response.ok) {
      let detail = body.slice(0, 200);
      try { detail = JSON.parse(body).message || detail; } catch {}
      throw new Error(`Azure DevOps ${response.status}: ${detail}`);
    }
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}

async function commentsFor(base, project, id, token) {
  const comments = [];
  let continuation = '';
  const seenPages = new Set();
  do {
    const projectPath = project ? `/${encodeURIComponent(project)}` : '';
    const url = new URL(`${base}${projectPath}/_apis/wit/workItems/${id}/comments`);
    url.searchParams.set('api-version', '7.1-preview.4');
    url.searchParams.set('$top', '200');
    if (continuation) url.searchParams.set('continuationToken', continuation);
    const page = await request(url, token);
    for (const comment of page.comments || []) {
      comments.push({ author: comment.createdBy?.displayName || '', createdAt: comment.createdDate || '', text: plainText(comment.text) });
    }
    continuation = page.continuationToken || '';
    if (continuation && seenPages.has(continuation)) throw new Error(`Azure DevOps repeated a comments page for work item ${id}.`);
    if (continuation) seenPages.add(continuation);
  } while (continuation);
  return comments;
}

function relationId(url) {
  const match = String(url || '').match(/\/workItems\/(\d+)(?:\?|$)/i);
  return match ? Number(match[1]) : null;
}

async function fetchWorkItems(references, onProgress = () => {}) {
  const base = organizationUrl(store.getSettings().azureDevOpsOrgUrl);
  for (const reference of String(references || '').split(/[,;\s]+/)) {
    const text = reference.trim();
    if (!/^https?:\/\//i.test(text)) continue;
    if (organizationUrl(text).toLowerCase() !== base.toLowerCase()) throw new Error('Work item URLs must belong to the configured Azure DevOps organization.');
  }
  const rootIds = parseIds(references);
  if (!rootIds.length) throw new Error('Enter Azure DevOps work item IDs, AB# references, or work item URLs.');
  const token = credentials.get('azureDevOps');
  if (!token) throw new Error('Add an Azure DevOps access token in Settings first.');
  const queue = rootIds.map((id) => ({ id, rootId: id, parentId: null, relation: 'root' }));
  const discovered = new Set(rootIds);
  const seen = new Set();
  const items = [];
  while (queue.length) {
    const batch = [];
    while (queue.length && batch.length < 4) {
      const next = queue.shift();
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      batch.push(next);
    }
    const fetched = await Promise.all(batch.map(async (next) => {
      const url = new URL(`${base}/_apis/wit/workitems/${next.id}`);
      url.searchParams.set('$expand', 'relations');
      url.searchParams.set('api-version', '7.1');
      const raw = await request(url, token);
      const fields = raw.fields || {};
      const project = fields['System.TeamProject'] || '';
      return { next, relations: raw.relations || [], item: {
        id: raw.id,
        type: fields['System.WorkItemType'] || '',
        title: fields['System.Title'] || '',
        state: fields['System.State'] || '',
        createdAt: fields['System.CreatedDate'] || '',
        changedAt: fields['System.ChangedDate'] || '',
        closedAt: fields['Microsoft.VSTS.Common.ClosedDate'] || '',
        project,
        assignedTo: fields['System.AssignedTo']?.displayName || fields['System.AssignedTo'] || '',
        description: plainText(fields['System.Description']),
        acceptanceCriteria: plainText(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
        reproSteps: plainText(fields['Microsoft.VSTS.TCM.ReproSteps']),
        comments: await commentsFor(base, project, next.id, token),
        rootId: next.rootId,
        parentId: next.parentId,
        relation: next.relation,
        url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${raw.id}`
      } };
    }));
    for (const { next, item, relations } of fetched) {
      items.push(item);
      for (const relation of relations) {
        if (!['System.LinkTypes.Hierarchy-Forward', 'System.LinkTypes.Related'].includes(relation.rel)) continue;
        if (next.relation === 'related') continue;
        const id = relationId(relation.url);
        if (id && !discovered.has(id)) {
          discovered.add(id);
          queue.push({ id, rootId: next.rootId, parentId: item.id, relation: relation.rel === 'System.LinkTypes.Related' ? 'related' : 'child' });
        }
      }
    }
    onProgress({ loaded: items.length, queued: queue.length, roots: rootIds.length });
  }
  return { rootIds, items };
}

module.exports = { fetchWorkItems, parseIds, plainText, organizationUrl };
