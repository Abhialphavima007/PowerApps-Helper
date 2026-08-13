'use strict';
// Deployment notes in the style of Power Platform Pipelines' deployment notes.
// A deterministic template is always available (no API key needed); if a Gemini
// or Grok key is present the template is enriched into polished prose.

// ---------- deterministic pipeline-style template ----------
function componentLines(inspection) {
  const comps = (inspection?.components || []).map((c) =>
    c.schemaName ? `- ${c.type}: \`${c.schemaName}\`` : `- ${c.type}${c.count ? ` × ${c.count}` : ''}`
  );
  return comps.length ? comps.join('\n') : '- (no root components listed)';
}

function dependencyLines(inspection) {
  const deps = inspection?.dependencies || [];
  if (!deps.length) return '- None detected in the package.';
  return deps
    .map((d) => `- **${d.requiredType}** \`${d.requiredSchema}\` — required by ${d.dependentType} \`${d.dependentSchema}\``)
    .join('\n');
}

function summaryLine(inspection) {
  const s = inspection?.summary || {};
  const parts = Object.entries(s).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(' · ') : 'n/a';
}

function templateNotes(p) {
  const date = p.date || new Date().toISOString().slice(0, 10);
  const managed = p.exportManaged ? 'Managed' : 'Unmanaged';
  const wi = (p.workItems || '').trim();
  return `# Deployment Notes — ${p.solution}

**Version:** ${p.version || '(unchanged)'}
**Deployment:** ${p.sourceEnv} → ${p.targetEnv}
**Package:** ${managed}
**Deployed by:** ${p.developer || 'n/a'}
**Date:** ${date}

## Overview
${p.description ? p.description.trim() : '_No change description was provided._'}

## Changes in this release
${p.description ? p.description.trim().split(/\n+/).map((l) => `- ${l.replace(/^[-*]\s*/, '')}`).join('\n') : '- See overview.'}

## Components in this solution
${componentLines(p.inspection)}

_Content summary: ${summaryLine(p.inspection)}_

## Dependencies & prerequisites
${dependencyLines(p.inspection)}

## Related work items
${wi ? wi.split(/[,\n]+/).map((w) => `- ${w.trim()}`).filter((x) => x !== '- ').join('\n') : '- (none linked)'}

## Deployment steps
1. Confirm the required dependencies above exist in **${p.targetEnv}**.
2. Import the ${managed.toLowerCase()} solution package (version ${p.version || 'n/a'}).
3. ${p.exportManaged ? 'Apply any required upgrade/stage-and-upgrade step.' : 'Publish all customizations after import.'}
4. Activate any deactivated flows / processes if needed.

## Post-deployment verification
- Smoke-test the changed components listed above.
- Verify flows and connection references resolve in **${p.targetEnv}**.

## Rollback
- Re-import the previous solution version, or restore from the stored artifact for this deployment.
`;
}

// ---------- AI enrichment ----------
function buildPrompt(p) {
  return `You are a Power Platform release manager. Rewrite the following draft deployment notes into clear, professional, Power Platform Pipelines-style deployment notes in Markdown. Keep every section heading, keep it factual, do not invent changes beyond what is present, and tighten the wording.

Context:
- Solution: ${p.solution}
- Version: ${p.version || '(unchanged)'}
- Route: ${p.sourceEnv} -> ${p.targetEnv}
- Package: ${p.exportManaged ? 'Managed' : 'Unmanaged'}
- Deployed by: ${p.developer || 'n/a'}

Draft notes to refine:
"""
${templateNotes(p)}
"""

Return only the finished Markdown.`;
}

async function fetchWithTimeout(url, opts, ms = 60000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callGemini(prompt, apiKey, model) {
  const m = model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${safeMsg(text)}`);
  const data = JSON.parse(text);
  const out = data?.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') || '';
  if (!out) throw new Error('Gemini returned no content: ' + safeMsg(text));
  return out;
}

async function callGrok(prompt, apiKey, model) {
  const m = model || process.env.GROK_MODEL || 'grok-2-latest';
  const res = await fetchWithTimeout('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: m,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are a Power Platform release manager who writes precise deployment notes.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Grok ${res.status}: ${safeMsg(text)}`);
  const data = JSON.parse(text);
  const out = data?.choices?.[0]?.message?.content || '';
  if (!out) throw new Error('Grok returned no content.');
  return out;
}

function safeMsg(text) {
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.error || text;
  } catch {
    return text?.slice(0, 300);
  }
}

async function generateNotes(payload) {
  const requested = payload.provider || process.env.AI_PROVIDER || 'gemini';
  const geminiKey = process.env.GEMINI_API_KEY;
  const grokKey = process.env.GROK_API_KEY;

  // No key at all -> deterministic template (still useful).
  if ((requested === 'gemini' && !geminiKey) || (requested === 'grok' && !grokKey)) {
    if (!geminiKey && !grokKey) return { provider: 'template', notes: templateNotes(payload) };
  }

  const prompt = buildPrompt(payload);
  try {
    if (requested === 'grok' && grokKey) return { provider: 'grok', notes: await callGrok(prompt, grokKey, payload.model) };
    if (requested === 'gemini' && geminiKey) return { provider: 'gemini', notes: await callGemini(prompt, geminiKey, payload.model) };
    // requested provider has no key but the other does -> use whichever is available
    if (geminiKey) return { provider: 'gemini', notes: await callGemini(prompt, geminiKey, payload.model) };
    if (grokKey) return { provider: 'grok', notes: await callGrok(prompt, grokKey, payload.model) };
    return { provider: 'template', notes: templateNotes(payload) };
  } catch (e) {
    // On any AI failure, fall back to the template but report why.
    return { provider: 'template', notes: templateNotes(payload), warning: String(e.message || e) };
  }
}

function availableProviders() {
  return { gemini: !!process.env.GEMINI_API_KEY, grok: !!process.env.GROK_API_KEY };
}

module.exports = { generateNotes, availableProviders, templateNotes, buildPrompt };
