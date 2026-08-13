import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const STEPS = [
  { key: 'config', label: 'Configure', hint: 'Source, target, version' },
  { key: 'analyze', label: 'Analyze', hint: 'Dependencies & content' },
  { key: 'notes', label: 'Notes', hint: 'Deployment notes' },
  { key: 'deploy', label: 'Deploy', hint: 'Import to target' }
];

const STAGE_LABELS = {
  version: 'Set version',
  export: 'Export from source',
  analyze: 'Analyze package',
  store: 'Store artifact',
  import: 'Import to target',
  publish: 'Publish customizations'
};
const STAGE_ORDER = ['version', 'export', 'analyze', 'store', 'import', 'publish'];

function bumpVersion(v) {
  if (!v) return '1.0.0.1';
  const parts = String(v).split('.');
  const last = parts.length - 1;
  const n = parseInt(parts[last], 10);
  parts[last] = String(isNaN(n) ? 1 : n + 1);
  return parts.join('.');
}

function envName(envs, url) {
  const e = envs.find((x) => x.environmentUrl === url);
  return e ? e.displayName : url;
}

export default function DeployView({ account, envs, envLoading, envError, refreshEnvs, providers }) {
  const [step, setStep] = useState('config');
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [solutions, setSolutions] = useState([]);
  const [solLoading, setSolLoading] = useState(false);
  const [solutionName, setSolutionName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [workItems, setWorkItems] = useState('');
  const [exportManaged, setExportManaged] = useState(false);
  const [publishChanges, setPublishChanges] = useState(true);
  const [forceOverwrite, setForceOverwrite] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({}); // stage -> {status, percent, message}
  const [analysis, setAnalysis] = useState(null);
  const [notes, setNotes] = useState('');
  const [notesWarning, setNotesWarning] = useState('');
  const [provider, setProvider] = useState('gemini');
  const [genBusy, setGenBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [record, setRecord] = useState(null);
  const [gitCommit, setGitCommit] = useState(false);

  useEffect(() => {
    setProvider(providers.gemini ? 'gemini' : providers.grok ? 'grok' : 'template');
  }, [providers]);

  useEffect(() => {
    const off = api.deploy.onProgress((d) => {
      setProgress((prev) => ({ ...prev, [d.stage]: { status: d.status, percent: d.percent, message: d.message } }));
    });
    return off;
  }, []);

  const selectedSolution = useMemo(() => solutions.find((s) => s.uniqueName === solutionName), [solutions, solutionName]);

  const loadSolutions = async (url) => {
    if (!url) return;
    setSolLoading(true);
    setSolutions([]);
    setSolutionName('');
    try {
      const r = await api.solution.list(url);
      if (r.ok) setSolutions(r.solutions || []);
      else setError(r.error || 'Could not list solutions.');
    } finally {
      setSolLoading(false);
    }
  };

  const onSource = (url) => { setSourceUrl(url); loadSolutions(url); };

  useEffect(() => { if (selectedSolution) setVersion(bumpVersion(selectedSolution.version)); }, [selectedSolution]);

  const canAnalyze = sourceUrl && targetUrl && solutionName && sourceUrl !== targetUrl;

  const resetProgress = (keys) => setProgress((prev) => {
    const next = { ...prev };
    keys.forEach((k) => delete next[k]);
    return next;
  });

  const runAnalyze = async () => {
    setError('');
    setBusy(true);
    resetProgress(['version', 'export', 'analyze', 'store']);
    setAnalysis(null);
    try {
      const r = await api.deploy.exportSolution({
        sourceEnvUrl: sourceUrl,
        sourceEnvName: envName(envs, sourceUrl),
        targetEnvName: envName(envs, targetUrl),
        account: account?.username,
        solutionId: selectedSolution?.solutionId,
        solutionName,
        newVersion: version || undefined,
        exportManaged
      });
      if (!r.ok) { setError(r.error || 'Export failed.'); return; }
      setAnalysis(r);
      setStep('analyze');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const generateNotes = async () => {
    setError('');
    setNotesWarning('');
    setGenBusy(true);
    try {
      const r = await api.ai.generateNotes({
        provider,
        solution: selectedSolution?.friendlyName || solutionName,
        sourceEnv: envName(envs, sourceUrl),
        targetEnv: envName(envs, targetUrl),
        version,
        description,
        workItems,
        developer: account?.name || account?.username,
        exportManaged,
        inspection: analysis?.inspection
      });
      if (r.ok) {
        setNotes(r.notes || '');
        if (r.warning) setNotesWarning('AI unavailable, used template: ' + r.warning);
        else if (r.provider === 'template') setNotesWarning('Generated from template (no AI key or provider not selected).');
      } else {
        setError(r.error || 'Notes generation failed.');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const runDeploy = async () => {
    setError('');
    setBusy(true);
    resetProgress(['import', 'publish']);
    setImportResult(null);
    try {
      const r = await api.deploy.importSolution({
        targetEnvUrl: targetUrl,
        artifact: analysis.artifact,
        overwrite: forceOverwrite,
        publishChanges,
        exportManaged
      });
      setImportResult(r);

      const rec = await api.deploy.record({
        solution: selectedSolution?.friendlyName || solutionName,
        solutionUniqueName: solutionName,
        version,
        sourceEnv: envName(envs, sourceUrl),
        sourceUrl,
        targetEnv: envName(envs, targetUrl),
        targetUrl,
        account: account?.username,
        description,
        workItems,
        exportManaged,
        artifact: analysis.artifact,
        stored: analysis.stored || {},
        dependencies: analysis.inspection?.dependencies || [],
        summary: analysis.inspection?.summary || {},
        notes,
        status: r.ok ? 'success' : 'failed',
        error: r.ok ? null : r.error
      });
      setRecord(rec);

      if (gitCommit) {
        const dir = await api.util.artifactsDir();
        await api.git.commit(dir, `Deploy ${solutionName} v${version} -> ${envName(envs, targetUrl)}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('config');
    setAnalysis(null);
    setNotes('');
    setNotesWarning('');
    setImportResult(null);
    setRecord(null);
    setError('');
    setProgress({});
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const activeStages = STAGE_ORDER.filter((k) => progress[k]);

  return (
    <div>
      <p className="h1">Deploy a solution</p>
      <p className="sub">Move a Dataverse solution between environments with dependency review, versioning and deployment notes.</p>

      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s.key} className={'step ' + (s.key === step ? 'active' : i < stepIndex ? 'done' : '')}>
            <b>{i + 1}. {s.label}</b>{s.hint}
          </div>
        ))}
      </div>

      {error && <div className="alert err">{error}</div>}

      {step === 'config' && (
        <div className="card">
          <div className="toolbar">
            <h3 style={{ margin: 0, flex: 1 }}>Configure deployment {envLoading && <span className="spin" />}</h3>
            <button className="btn small secondary" onClick={refreshEnvs}>Refresh envs</button>
          </div>
          {envError && <div className="alert warn">{envError}</div>}
          <div className="row">
            <div className="col">
              <label>Source environment</label>
              <select value={sourceUrl} onChange={(e) => onSource(e.target.value)}>
                <option value="">Select source…</option>
                {envs.map((e) => <option key={e.environmentUrl} value={e.environmentUrl}>{e.displayName}</option>)}
              </select>
            </div>
            <div className="col">
              <label>Target environment</label>
              <select value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}>
                <option value="">Select target…</option>
                {envs.filter((e) => e.environmentUrl !== sourceUrl).map((e) => <option key={e.environmentUrl} value={e.environmentUrl}>{e.displayName}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <div className="col">
              <label>Solution {solLoading && <span className="spin" />}</label>
              <select value={solutionName} onChange={(e) => setSolutionName(e.target.value)} disabled={!sourceUrl}>
                <option value="">{sourceUrl ? 'Select solution…' : 'Pick a source first'}</option>
                {solutions.map((s) => (
                  <option key={s.uniqueName} value={s.uniqueName}>{s.friendlyName} ({s.uniqueName}) v{s.version}{s.isManaged ? ' · managed' : ''}</option>
                ))}
              </select>
            </div>
            <div className="col" style={{ maxWidth: 200 }}>
              <label>New version {selectedSolution ? `(was ${selectedSolution.version})` : ''}</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0.1" />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label>What changes are going with this solution? (used for deployment notes)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Added Approval status field to Case table, updated routing flow, new admin role…" />
          </div>
          <div style={{ marginTop: 14 }}>
            <label>Related work items / references (optional)</label>
            <input value={workItems} onChange={(e) => setWorkItems(e.target.value)} placeholder="e.g. AB#1234, JIRA-56, ticket URLs (comma separated)" />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Checkbox label="Export as managed" checked={exportManaged} onChange={setExportManaged} />
            <Checkbox label="Publish after import" checked={publishChanges} onChange={setPublishChanges} disabled={exportManaged} />
            <Checkbox label="Overwrite unmanaged customizations" checked={forceOverwrite} onChange={setForceOverwrite} />
          </div>
          <div className="right">
            <button className="btn" disabled={!canAnalyze || busy} onClick={runAnalyze}>
              {busy ? <span className="spin" /> : 'Export & analyze →'}
            </button>
          </div>
          {sourceUrl && sourceUrl === targetUrl && <div className="alert warn" style={{ marginTop: 12 }}>Source and target must differ.</div>}
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
        </div>
      )}

      {step === 'analyze' && analysis && (
        <AnalyzeStep
          analysis={analysis}
          onBack={() => setStep('config')}
          onNext={() => setStep('notes')}
          onReveal={() => api.util.revealPath(analysis.artifact)}
        />
      )}

      {step === 'notes' && (
        <div className="card">
          <h3>Deployment notes</h3>
          <div className="toolbar">
            <div style={{ maxWidth: 240 }}>
              <label>Style / provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="gemini" disabled={!providers.gemini}>Gemini {providers.gemini ? '' : '(no key)'}</option>
                <option value="grok" disabled={!providers.grok}>Grok {providers.grok ? '' : '(no key)'}</option>
                <option value="template">Template (no AI)</option>
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button className="btn secondary" disabled={genBusy} onClick={generateNotes}>
                {genBusy ? <span className="spin" /> : notes ? 'Regenerate' : 'Generate notes'}
              </button>
            </div>
          </div>
          {notesWarning && <div className="alert info">{notesWarning}</div>}
          <label>Notes (editable Markdown, pipeline-style)</label>
          <textarea style={{ minHeight: 300 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Click Generate, or write deployment notes…" />
          <div className="right">
            <button className="btn secondary" onClick={() => setStep('analyze')}>← Back</button>
            <button className="btn" onClick={() => setStep('deploy')}>Continue to deploy →</button>
          </div>
        </div>
      )}

      {step === 'deploy' && (
        <div className="card">
          <h3>Deploy to {envName(envs, targetUrl)}</h3>
          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="k">Solution</div><div>{selectedSolution?.friendlyName || solutionName}</div>
            <div className="k">Version</div><div>{version}</div>
            <div className="k">Route</div><div>{envName(envs, sourceUrl)} → {envName(envs, targetUrl)}</div>
            <div className="k">Type</div><div>{exportManaged ? 'Managed' : 'Unmanaged'}</div>
            <div className="k">Dependencies flagged</div><div>{analysis?.inspection?.dependencies?.length || 0}</div>
            <div className="k">Artifact stored</div>
            <div>
              {analysis?.stored?.storage === 'onedrive'
                ? <button className="btn small secondary" onClick={() => api.util.openExternal(analysis.stored.oneDriveUrl)}>Open in OneDrive</button>
                : analysis?.stored?.storedPath
                  ? <button className="btn small secondary" onClick={() => api.util.revealPath(analysis.stored.storedPath)}>Reveal file</button>
                  : '—'}
            </div>
          </div>
          <Checkbox label="Commit artifact + notes to local git" checked={gitCommit} onChange={setGitCommit} />
          {!importResult && (
            <div className="right">
              <button className="btn secondary" onClick={() => setStep('notes')}>← Back</button>
              <button className="btn" disabled={busy} onClick={runDeploy}>{busy ? <span className="spin" /> : '🚀 Import to target'}</button>
            </div>
          )}
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
          {importResult && (
            <div className={'alert ' + (importResult.ok ? 'info' : 'err')} style={{ marginTop: 14 }}>
              {importResult.ok ? '✔ Import completed and recorded in history.' : '✖ Import failed: ' + (importResult.error || '')}
              {record && (
                <div className="right">
                  {record.notesFile && <button className="btn small secondary" onClick={() => api.util.revealPath(record.notesFile)}>Open notes file</button>}
                  <button className="btn small" onClick={reset}>New deployment</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressPanel({ stages, progress }) {
  return (
    <div className="progress-panel">
      {stages.map((k) => {
        const s = progress[k] || {};
        const pct = typeof s.percent === 'number' ? s.percent : null;
        const icon = s.status === 'done' ? '✔' : s.status === 'error' ? '✕' : '';
        return (
          <div key={k} className={'pstage ' + (s.status || '')}>
            <div className="pstage-head">
              <span className={'pstage-icon ' + (s.status || '')}>{icon || <span className="spin" />}</span>
              <span className="pstage-label">{STAGE_LABELS[k] || k}</span>
              <span className="pstage-msg">{s.message}</span>
            </div>
            <div className="pbar">
              <div
                className={'pbar-fill ' + (s.status === 'error' ? 'err' : s.status === 'done' ? 'done' : '') + (pct === null && s.status === 'running' ? ' indet' : '')}
                style={pct !== null ? { width: pct + '%' } : (s.status === 'done' ? { width: '100%' } : undefined)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalyzeStep({ analysis, onBack, onNext, onReveal }) {
  const insp = analysis.inspection || {};
  const deps = insp.dependencies || [];
  const summary = insp.summary || {};
  const comps = insp.components || [];
  const stored = analysis.stored || {};
  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0, flex: 1 }}>Package analyzed</h3>
          {stored.storage === 'onedrive'
            ? <button className="btn small secondary" onClick={() => api.util.openExternal(stored.oneDriveUrl)}>Open in OneDrive</button>
            : <button className="btn small secondary" onClick={onReveal}>Reveal .zip</button>}
        </div>
        <div className="grid2">
          <div className="k">Unique name</div><div>{insp.uniqueName || '—'}</div>
          <div className="k">Version</div><div>{insp.version || '—'}</div>
          <div className="k">Managed</div><div>{insp.managed ? 'Yes' : 'No'}</div>
          <div className="k">Stored</div>
          <div className="muted">{stored.storage === 'onedrive' ? 'OneDrive' : stored.storedPath ? 'Local: ' + stored.storedPath : '—'}</div>
        </div>
      </div>

      <div className="card">
        <h3>Dependencies {deps.length > 0 && <span className="pill warn">{deps.length}</span>}</h3>
        <p className="muted" style={{ marginTop: 0 }}>Components this solution depends on. Ensure required items exist in the target before importing.</p>
        {deps.length === 0 ? (
          <div className="alert info">No missing dependencies detected in the package.</div>
        ) : (
          <table>
            <thead><tr><th>Required component</th><th>Type</th><th>Needed by</th></tr></thead>
            <tbody>
              {deps.map((d, i) => (
                <tr key={i}>
                  <td>{d.requiredSchema || '—'}</td>
                  <td className="muted">{d.requiredType}</td>
                  <td className="muted">{d.dependentType} {d.dependentSchema ? `· ${d.dependentSchema}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {comps.length > 0 && (
        <div className="card">
          <h3>Root components</h3>
          <div className="badge-list">
            {comps.slice(0, 60).map((c, i) => (
              <span key={i} className="pill muted">{c.schemaName ? `${c.type}: ${c.schemaName}` : `${c.type}${c.count ? ' ×' + c.count : ''}`}</span>
            ))}
          </div>
        </div>
      )}

      <div className="right">
        <button className="btn secondary" onClick={onBack}>← Back</button>
        <button className="btn" onClick={onNext}>Continue to notes →</button>
      </div>
    </div>
  );
}

function Checkbox({ label, checked, onChange, disabled }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: disabled ? 'var(--muted)' : 'var(--text)', marginBottom: 0 }}>
      <input type="checkbox" style={{ width: 'auto' }} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
