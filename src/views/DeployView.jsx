import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import WorkItemDetails from '../components/WorkItemDetails.jsx';
import FullscreenSummary from '../components/FullscreenSummary.jsx';

const STEPS = [
  { key: 'config', label: 'Configure', hint: 'Source, target, type' },
  { key: 'analyze', label: 'Review', hint: 'Dependencies & notes' },
  { key: 'deploy', label: 'Deploy', hint: 'Import to target' }
];

const STAGE_LABELS = {
  version: 'Set version', export: 'Export from source', analyze: 'Analyze package',
  store: 'Store artifact', agent: 'Deployment agent', import: 'Import to target',
  repair: 'Add source dependencies', reexport: 'Re-export source', publish: 'Publish customizations'
};
const STAGE_ORDER = ['version', 'export', 'analyze', 'store', 'agent', 'import', 'repair', 'reexport', 'publish'];

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
function TypePill({ managed }) {
  return <span className={'pill ' + (managed ? 'managed' : 'unmanaged')}>{managed ? 'Managed' : 'Unmanaged'}</span>;
}

function ProviderSelect({ provider, setProvider, providers }) {
  return <select value={provider} onChange={(event) => setProvider(event.target.value)}>
    <option value="foundry" disabled={!providers.foundry}>Azure AI Foundry {providers.foundry ? '' : '(configure in Settings)'}</option>
    <option value="openai" disabled={!providers.openai}>OpenAI / Codex {providers.openai ? '' : '(no key)'}</option>
    <option value="claude" disabled={!providers.claude}>Claude {providers.claude ? '' : '(no key)'}</option>
    <option value="grok" disabled={!providers.grok}>Grok {providers.grok ? '' : '(no key)'}</option>
    <option value="gemini" disabled={!providers.gemini}>Gemini {providers.gemini ? '' : '(no key)'}</option>
    <option value="template">Template (no AI)</option>
  </select>;
}

function SolutionCombobox({ solutions, selected, onSelect, disabled, loading }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? solutions.filter((s) => `${s.friendlyName} ${s.uniqueName}`.toLocaleLowerCase().includes(needle)) : solutions;
  }, [solutions, query]);
  const displayName = selected ? `${selected.friendlyName} (${selected.uniqueName})` : '';
  const openList = () => {
    if (disabled) return;
    setQuery('');
    setActive(0);
    setOpen(true);
  };
  const choose = (solution) => {
    onSelect(solution.uniqueName);
    setQuery('');
    setOpen(false);
  };
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else setActive((index) => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) openList();
      else if (matches[active]) choose(matches[active]);
    }
  };

  return <div className="solution-combobox" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); }
  }}>
    <div className="solution-combobox-field">
      <input
        ref={inputRef}
        id="solution-search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="solution-options"
        aria-expanded={open}
        aria-activedescendant={open && matches[active] ? `solution-option-${active}` : undefined}
        value={open ? query : displayName}
        onFocus={() => { if (!open) openList(); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); onSelect(''); }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={loading ? 'Loading solutions…' : disabled ? 'Pick a source first' : 'Type or choose a solution…'}
      />
      <button type="button" aria-label="Show solutions" aria-expanded={open} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (open) setOpen(false);
        else { openList(); inputRef.current?.focus(); }
      }}>▾</button>
    </div>
    {open && <div className="solution-combobox-options" id="solution-options" role="listbox" aria-label="Solutions">
      {matches.length ? matches.map((solution, index) => <button
        id={`solution-option-${index}`}
        key={solution.uniqueName}
        type="button"
        role="option"
        aria-selected={selected?.uniqueName === solution.uniqueName}
        className={index === active ? 'active' : ''}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(solution)}
      >{solution.friendlyName} <span className="muted">({solution.uniqueName}) · v{solution.version}</span></button>) : <div className="solution-combobox-empty">{solutions.length ? 'No matching unmanaged solutions' : 'No unmanaged solutions found'}</div>}
    </div>}
  </div>;
}

export default function DeployView({ account, envs, envLoading, envError, refreshEnvs, providers }) {
  const [mode, setMode] = useState('source'); // 'source' | 'file'
  const [step, setStep] = useState('config');
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [solutions, setSolutions] = useState([]);
  const [solLoading, setSolLoading] = useState(false);
  const solutionRequest = useRef(0);
  const [solutionName, setSolutionName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [workItems, setWorkItems] = useState('');
  const [workItemDetails, setWorkItemDetails] = useState(null);
  const [workItemError, setWorkItemError] = useState('');
  const [workItemLoading, setWorkItemLoading] = useState(false);
  const [workItemProgress, setWorkItemProgress] = useState(null);
  const [workSummary, setWorkSummary] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState(null);
  const workRequest = useRef(0);
  const workTimer = useRef(null);
  const [deployType, setDeployType] = useState('managed'); // default managed, like pipelines
  const [publishChanges, setPublishChanges] = useState(true);
  const [forceOverwrite, setForceOverwrite] = useState(true);

  // file mode
  const [filePath, setFilePath] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [notes, setNotes] = useState(null);
  const [notesWarning, setNotesWarning] = useState('');
  const [provider, setProvider] = useState('gemini');
  const [genBusy, setGenBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [record, setRecord] = useState(null);
  const [gitCommit, setGitCommit] = useState(false);

  useEffect(() => { setProvider(providers.foundry ? 'foundry' : providers.openai ? 'openai' : providers.claude ? 'claude' : providers.grok ? 'grok' : providers.gemini ? 'gemini' : 'template'); }, [providers]);
  useEffect(() => { setNotes(null); setNotesWarning(''); }, [mode, sourceUrl, targetUrl, solutionName, filePath]);
  useEffect(() => {
    const off = api.deploy.onProgress((d) => setProgress((prev) => ({ ...prev, [d.stage]: { status: d.status, percent: d.percent, message: d.message } })));
    return off;
  }, []);

  const selectedSolution = useMemo(() => solutions.find((s) => s.uniqueName === solutionName), [solutions, solutionName]);

  const loadSolutions = async (url) => {
    const request = ++solutionRequest.current;
    setSolLoading(true); setSolutions([]); setSolutionName('');
    if (!url) { setSolLoading(false); return; }
    try {
      const r = await api.solution.list(url);
      if (request !== solutionRequest.current) return;
      if (r.ok) setSolutions((r.solutions || []).filter((solution) => !solution.isManaged)); else setError(r.error || 'Could not list solutions.');
    } catch (e) {
      if (request === solutionRequest.current) setError(String(e));
    } finally { if (request === solutionRequest.current) setSolLoading(false); }
  };
  const onSource = (url) => { setSourceUrl(url); loadSolutions(url); };
  useEffect(() => { if (selectedSolution) setVersion(bumpVersion(selectedSolution.version)); }, [selectedSolution]);

  const fetchWorkItems = async (references) => {
    const request = ++workRequest.current;
    setWorkItemLoading(true); setWorkItemError(''); setWorkItemProgress(null);
    try {
      const result = await api.devops.fetch(references, (progress) => { if (request === workRequest.current) setWorkItemProgress(progress); });
      if (request !== workRequest.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not load Azure DevOps work items.');
      setWorkItemDetails(result);
    } catch (error) {
      if (request === workRequest.current) { setWorkItemDetails(null); setWorkItemError(String(error.message || error)); }
    } finally {
      if (request === workRequest.current) setWorkItemLoading(false);
    }
  };
  useEffect(() => {
    ++workRequest.current;
    setWorkItemDetails(null); setWorkItemError(''); setWorkItemLoading(false); setWorkItemProgress(null);
    if (!workItems.split(/[,;\s]+/).some((part) => /^(?:AB#|#)?\d+$|\/_workitems\/edit\/\d+/i.test(part.trim()))) return;
    workTimer.current = setTimeout(() => fetchWorkItems(workItems), 900);
    return () => clearTimeout(workTimer.current);
  }, [workItems]);

  const generateWorkSummary = async () => {
    const request = workRequest.current;
    setSummaryBusy(true); setSummaryProgress(null); setWorkItemError('');
    try {
      const result = await api.ai.summarizeWorkItems({ provider, workItemDetails }, setSummaryProgress);
      if (request !== workRequest.current) return;
      if (!result.ok) throw new Error(result.error || 'AI summary failed.');
      setDescription((current) => workSummary && current.includes(workSummary)
        ? current.replace(workSummary, result.summary)
        : [current.trim(), result.summary].filter(Boolean).join('\n\n'));
      setWorkSummary(result.summary);
    } catch (error) { setWorkItemError(String(error.message || error)); }
    finally { setSummaryBusy(false); }
  };

  // Effective managed flag for the current deployment.
  const managed = mode === 'file' ? !!analysis?.inspection?.managed : deployType === 'managed';
  const effectiveNotes = notes === null ? description : notes;

  const resetProgress = (keys) => setProgress((prev) => { const next = { ...prev }; keys.forEach((k) => delete next[k]); return next; });

  const canAnalyzeSource = sourceUrl && targetUrl && selectedSolution && !selectedSolution.isManaged && sourceUrl !== targetUrl;
  const canAnalyzeFile = targetUrl && filePath;

  const runAnalyzeSource = async () => {
    setError(''); setBusy(true); resetProgress(['version', 'export', 'analyze', 'store']); setAnalysis(null);
    try {
      const r = await api.deploy.exportSolution({
        sourceEnvUrl: sourceUrl, sourceEnvName: envName(envs, sourceUrl), targetEnvName: envName(envs, targetUrl),
        account: account?.username, solutionId: selectedSolution?.solutionId, solutionName,
        newVersion: version || undefined, exportManaged: deployType === 'managed'
      });
      if (!r.ok) { setError(r.error || 'Export failed.'); return; }
      setAnalysis(r); setStep('analyze');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const pickFile = async () => {
    setError('');
    const r = await api.deploy.pickZip();
    if (!r.ok) return;
    setFilePath(r.path);
    setBusy(true);
    try {
      const insp = await api.deploy.inspectFile(r.path);
      if (insp.ok) setAnalysis(insp); else setError(insp.error || 'Could not read package.');
    } finally { setBusy(false); }
  };

  const runAnalyzeFile = () => { if (analysis) setStep('analyze'); };

  const continueWithAgent = () => {
    setError(''); setAnalysis(null); setImportResult(null); setRecord(null);
    setProgress({}); setStep('deploy');
  };

  const generateNotes = async () => {
    setError(''); setNotesWarning(''); setGenBusy(true);
    try {
      const r = await api.ai.generateNotes({
        provider,
        solution: mode === 'file' ? (analysis?.inspection?.uniqueName || 'Solution') : (selectedSolution?.friendlyName || solutionName),
        sourceEnv: mode === 'file' ? '(package file)' : envName(envs, sourceUrl),
        targetEnv: envName(envs, targetUrl),
        version: mode === 'file' ? analysis?.inspection?.version : version,
        description, workItems, developer: account?.name || account?.username,
        exportManaged: managed, inspection: analysis?.inspection, workItemDetails
      });
      if (r.ok) {
        setNotes(r.notes || '');
        if (r.warning) setNotesWarning('AI unavailable, used template: ' + r.warning);
        else if (r.provider === 'template') setNotesWarning('Generated from template (no AI key or provider not selected).');
      } else setError(r.error || 'Notes generation failed.');
    } catch (e) { setError(String(e)); } finally { setGenBusy(false); }
  };

  const runDeploy = async () => {
    setError(''); setBusy(true); resetProgress(['import', 'publish']); setImportResult(null);
    try {
      const r = await api.deploy.importSolution({
        targetEnvUrl: targetUrl, artifact: analysis.artifact,
        overwrite: forceOverwrite, publishChanges, exportManaged: managed
      });
      setImportResult(r);
      const rec = await api.deploy.record({
        solution: mode === 'file' ? (analysis?.inspection?.uniqueName || filePath.split(/[\\/]/).pop()) : (selectedSolution?.friendlyName || solutionName),
        solutionUniqueName: mode === 'file' ? analysis?.inspection?.uniqueName : solutionName,
        version: mode === 'file' ? analysis?.inspection?.version : version,
        sourceEnv: mode === 'file' ? 'Package file' : envName(envs, sourceUrl),
        sourceUrl: mode === 'file' ? '' : sourceUrl,
        targetEnv: envName(envs, targetUrl), targetUrl, account: account?.username,
        description, workItems, workItemDetails, workItemSummary: workSummary, exportManaged: managed, mode,
        artifact: analysis.artifact, stored: analysis.stored || {},
        dependencies: analysis.inspection?.dependencies || [], summary: analysis.inspection?.summary || {},
        notes: effectiveNotes, status: r.ok ? 'success' : 'failed', warning: r.warning || null, error: r.ok ? null : r.error
      });
      setRecord(rec);
      if (gitCommit) {
        const dir = await api.util.artifactsDir();
        await api.git.commit(dir, `Deploy ${rec.solutionUniqueName || rec.solution} v${rec.version} -> ${rec.targetEnv}`);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const runAgent = async () => {
    const snapshot = {
      mode: 'source',
      accountId: account?.homeAccountId,
      account: account?.username,
      sourceUrl,
      sourceEnv: envName(envs, sourceUrl),
      targetUrl,
      targetEnv: envName(envs, targetUrl),
      solution: selectedSolution?.friendlyName || solutionName,
      solutionUniqueName: solutionName,
      solutionId: selectedSolution?.solutionId,
      version,
      exportManaged: managed,
      publishChanges,
      overwrite: forceOverwrite,
      description,
      workItems,
      workItemDetails,
      workItemSummary: workSummary,
      notes: effectiveNotes,
      gitCommit,
      deferExport: !analysis,
      analysis
    };
    setError(''); setBusy(true); resetProgress(STAGE_ORDER); setImportResult(null); setRecord(null);
    try {
      const result = await api.deploy.runAgent(snapshot);
      setImportResult({ ...result, agent: true });
      if (result.analysis) setAnalysis(result.analysis);
      if (result.record) setRecord(result.record);
      if (!result.ok && !result.record) setError(result.error || 'Agent deployment failed.');
    } catch (error) { setError(String(error.message || error)); }
    finally { setBusy(false); }
  };

  const reset = () => {
    setStep('config'); setAnalysis(null); setNotes(null); setNotesWarning('');
    setImportResult(null); setRecord(null); setError(''); setProgress({}); setFilePath('');
    setDescription(''); setWorkItems(''); setWorkItemDetails(null); setWorkSummary('');
    setSummaryExpanded(false);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const activeStages = STAGE_ORDER.filter((k) => progress[k]);

  return (
    <div>
      <p className="h1">Deploy a solution</p>
      <p className="sub">Move a Dataverse solution between environments — as managed or unmanaged — with dependency review, versioning and deployment notes.</p>

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
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={mode === 'source' ? 'on' : ''} onClick={() => { setMode('source'); setAnalysis(null); }}>From source environment</button>
            <button className={mode === 'file' ? 'on' : ''} onClick={() => { setMode('file'); setAnalysis(null); }}>Deploy existing package (.zip)</button>
          </div>

          <div className="toolbar">
            <h3 style={{ margin: 0, flex: 1 }}>Configure deployment {envLoading && <span className="spin" />}</h3>
            <button className="btn small secondary" onClick={refreshEnvs}>Refresh envs</button>
          </div>
          {envError && <div className="alert warn">{envError}</div>}

          {mode === 'source' ? (
            <>
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
                  <label htmlFor="solution-search">Unmanaged source solution {solLoading && <span className="spin" />}</label>
                  <SolutionCombobox key={sourceUrl || 'no-source'} solutions={solutions} selected={selectedSolution} onSelect={setSolutionName} disabled={!sourceUrl || solLoading} loading={solLoading} />
                  <p className="muted" style={{ margin: '6px 0 0' }}>Only unmanaged source solutions are listed. You can export one as a managed or unmanaged package below.</p>
                </div>
                <div className="col" style={{ maxWidth: 200 }}>
                  <label>New version {selectedSolution ? `(was ${selectedSolution.version})` : ''}</label>
                  <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0.1" />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label>Deploy as</label>
                <div className="seg">
                  <button className={deployType === 'managed' ? 'on' : ''} onClick={() => setDeployType('managed')}>Managed (recommended)</button>
                  <button className={deployType === 'unmanaged' ? 'on' : ''} onClick={() => setDeployType('unmanaged')}>Unmanaged</button>
                </div>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  {deployType === 'managed'
                    ? 'Exports and imports a managed package — the standard way to move to test/prod.'
                    : 'Exports and imports an unmanaged package — customizations remain editable in the target.'}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <div className="col">
                  <label>Target environment</label>
                  <select value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}>
                    <option value="">Select target…</option>
                    {envs.map((e) => <option key={e.environmentUrl} value={e.environmentUrl}>{e.displayName}</option>)}
                  </select>
                </div>
                <div className="col">
                  <label>Solution package (.zip)</label>
                  <div className="row" style={{ alignItems: 'center' }}>
                    <input readOnly value={filePath ? filePath.split(/[\\/]/).pop() : ''} placeholder="No file selected" />
                    <button className="btn secondary" style={{ maxWidth: 130 }} onClick={pickFile}>{busy ? <span className="spin" /> : 'Choose…'}</button>
                  </div>
                </div>
              </div>
              {analysis?.inspection && (
                <div className="alert info" style={{ marginTop: 12 }}>
                  Package: <b>{analysis.inspection.uniqueName || '—'}</b> v{analysis.inspection.version || '—'} · <TypePill managed={analysis.inspection.managed} /> · {analysis.inspection.dependencies?.length || 0} dependencies
                </div>
              )}
              <p className="muted" style={{ marginTop: 8 }}>
                Deploy a prebuilt package directly to the target — the same way a CI/CD pipeline promotes a managed solution downstream. You can pick a package the app exported earlier (see the OneDrive/local folder in Settings).
              </p>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <label>Related work items / references (optional)</label>
            <div className="row" style={{ alignItems: 'center' }}>
              <input value={workItems} onChange={(e) => setWorkItems(e.target.value)} placeholder="e.g. AB#1234, 5678 or Azure DevOps work item URLs" />
              <button className="btn secondary" disabled={!workItems.trim() || workItemLoading} onClick={() => { clearTimeout(workTimer.current); fetchWorkItems(workItems); }}>{workItemLoading ? <span className="spin" /> : 'Refresh details'}</button>
            </div>
            {workItemError && <div className="alert warn" style={{ marginTop: 10 }}>{workItemError}</div>}
            {workItemLoading && workItemProgress && <p className="muted">Loaded {workItemProgress.loaded} items · {workItemProgress.queued} queued across {workItemProgress.roots} stories…</p>}
            {workItemDetails && <WorkItemDetails details={workItemDetails} />}
            {workItemDetails && <p className="muted">Fetched work item details will be saved with this deployment's history record.</p>}
            {workItemDetails && <div className="row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
              <div className="col" style={{ maxWidth: 260 }}><label>AI provider for summary</label><ProviderSelect provider={provider} setProvider={setProvider} providers={providers} /></div>
              <button className="btn secondary" disabled={summaryBusy || provider === 'template'} onClick={generateWorkSummary}>{summaryBusy ? <span className="spin" /> : 'AI summary → Add to changes'}</button>
            </div>}
            {workItemDetails && provider === 'template' && <p className="muted">Add an AI API key in Settings to enable an AI summary.</p>}
            {summaryBusy && summaryProgress && <p className="muted">AI analyzed {summaryProgress.completed} of {summaryProgress.total} parts…</p>}
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="summary-field-heading">
              <label htmlFor="change-summary">What changes are going with this solution? (used for deployment notes)</label>
              <button className="btn small secondary" disabled={!description.trim()} onClick={() => setSummaryExpanded(true)}>View full screen</button>
            </div>
            <textarea id="change-summary" className="change-summary-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe changes yourself, or fetch work items and add an AI summary above…" />
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <Checkbox label="Publish after import" checked={publishChanges} onChange={setPublishChanges} disabled={managed} />
            <Checkbox label="Overwrite unmanaged customizations" checked={forceOverwrite} onChange={setForceOverwrite} />
          </div>

          <div className="right">
            {mode === 'source' ? (
              <>
                <button className="btn secondary" disabled={!canAnalyzeSource || busy} onClick={runAnalyzeSource}>{busy ? <span className="spin" /> : 'Export & review →'}</button>
                <button className="btn agent-button" disabled={!canAnalyzeSource || busy} onClick={continueWithAgent}>Continue with agent →</button>
              </>
            ) : (
              <button className="btn" disabled={!canAnalyzeFile || busy} onClick={runAnalyzeFile}>Analyze & continue →</button>
            )}
          </div>
          {mode === 'source' && <p className="muted agent-help">Continue with agent to review the deployment before exporting. The agent exports when you start it; package dependency warnings alone do not trigger source changes.</p>}
          {mode === 'source' && sourceUrl && sourceUrl === targetUrl && <div className="alert warn" style={{ marginTop: 12 }}>Source and target must differ.</div>}
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
        </div>
      )}

      {step === 'analyze' && analysis && (
        <>
          <AnalyzeStep analysis={analysis} managed={managed} onReveal={() => api.util.revealPath(analysis.artifact)} />
          <div className="card">
            <h3>Deployment notes</h3>
            <p className="muted">Your change summary is already included below. Edit it here, or generate formatted notes using the package analysis.</p>
            <div className="toolbar">
              <div style={{ maxWidth: 240 }}>
                <label>Format with</label>
                <ProviderSelect provider={provider} setProvider={setProvider} providers={providers} />
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="btn secondary" disabled={genBusy} onClick={generateNotes}>{genBusy ? <span className="spin" /> : notes === null ? 'Generate formatted notes' : 'Regenerate notes'}</button>
              </div>
            </div>
            {notesWarning && <div className="alert info">{notesWarning}</div>}
            <label htmlFor="deployment-notes">Notes saved with this deployment</label>
            <textarea id="deployment-notes" style={{ minHeight: 220 }} value={effectiveNotes} onChange={(e) => setNotes(e.target.value)} placeholder="Write deployment notes or generate formatted notes…" />
            <div className="right">
              <button className="btn secondary" disabled={genBusy} onClick={() => setStep('config')}>← Back</button>
              <button className="btn" disabled={genBusy} onClick={() => setStep('deploy')}>Continue to deploy →</button>
            </div>
          </div>
        </>
      )}

      {step === 'deploy' && (
        <div className="card">
          <h3>Deploy to {envName(envs, targetUrl)}</h3>
          {mode === 'source' && !analysis && <div className="alert info">The agent will set the version, export the source solution, and import it into the target when you start deployment. It will repair dependencies only if the target import fails with identifiable missing components.</div>}
          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="k">Solution</div><div>{mode === 'file' ? (analysis?.inspection?.uniqueName || filePath.split(/[\\/]/).pop()) : (selectedSolution?.friendlyName || solutionName)}</div>
            <div className="k">Version</div><div>{mode === 'file' ? analysis?.inspection?.version : version}</div>
            <div className="k">Route</div><div>{mode === 'file' ? 'Package file' : envName(envs, sourceUrl)} → {envName(envs, targetUrl)}</div>
            <div className="k">Type</div><div><TypePill managed={managed} /></div>
            <div className="k">Dependencies flagged</div><div>{analysis ? (analysis.inspection?.dependencies?.length || 0) : 'Checked after export'}</div>
            <div className="k">Artifact</div>
            <div>
              {analysis?.stored?.storage === 'onedrive'
                ? <button className="btn small secondary" onClick={() => api.util.openExternal(analysis.stored.oneDriveUrl)}>Open in OneDrive</button>
                : analysis?.stored?.storedPath
                  ? <button className="btn small secondary" onClick={() => api.util.revealPath(analysis.stored.storedPath)}>Reveal file</button>
                  : analysis ? '—' : 'Export when agent starts'}
            </div>
          </div>
          {mode === 'source' && !analysis && !importResult && <div style={{ marginBottom: 14 }}>
            <label htmlFor="agent-deployment-notes">Deployment notes</label>
            <textarea id="agent-deployment-notes" value={effectiveNotes} onChange={(event) => setNotes(event.target.value)} placeholder="Your change summary appears here. You can edit these notes before starting the agent." />
          </div>}
          <Checkbox label="Commit artifact + notes to local git" checked={gitCommit} onChange={setGitCommit} />
          {!importResult && (
            <div className="right deploy-actions">
              <button className="btn secondary" disabled={busy} onClick={() => setStep(analysis ? 'analyze' : 'config')}>← Back</button>
              {mode === 'source' && <button className="btn agent-button" disabled={busy} onClick={runAgent}>{busy ? <span className="spin" /> : 'Deploy with agent'}</button>}
              {analysis && <button className="btn" disabled={busy} onClick={runDeploy}>{busy ? <span className="spin" /> : `🚀 Import ${managed ? 'managed' : 'unmanaged'} to target`}</button>}
            </div>
          )}
          {mode === 'source' && !importResult && <p className="muted agent-help">The agent imports, reads failed target-import dependencies, adds identifiable components to the source solution through Microsoft Dataverse MCP when supported (or the authenticated Dataverse API fallback), then re-exports and retries up to twice. Package dependency warnings alone do not trigger repairs. Your route, work items, description and notes stay selected.</p>}
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
          {importResult && (
            <div className={'alert ' + (importResult.ok ? 'info' : 'err')} style={{ marginTop: 14 }}>
              {importResult.ok ? (record ? '✔ Import completed and recorded in history.' : '✔ Import completed; history could not be saved.') : (importResult.agent ? '✖ Agent stopped: ' : '✖ Import failed: ') + (importResult.error || '')}
              {importResult.warning && <p>{importResult.warning}</p>}
              {importResult.attempts?.length > 0 && <p>Import attempts: {importResult.attempts.length}. Source components added: {importResult.repairs?.length || 0}.</p>}
              {importResult.dependencies?.length > 0 && <p>Failed-import dependencies: {importResult.dependencies.map((item) => item.requiredSchema || item.requiredId || item.requiredType).join(', ')}</p>}
              {importResult.importLog && <details><summary>View Dataverse import log</summary><pre className="log">{importResult.importLog}</pre></details>}
              <div className="right">
                {record?.notesFile && <button className="btn small secondary" onClick={() => api.util.revealPath(record.notesFile)}>Open notes file</button>}
                {!importResult.ok && <button className="btn small secondary" onClick={() => { setImportResult(null); setRecord(null); resetProgress(STAGE_ORDER); }}>Retry with these details</button>}
                <button className="btn small" onClick={reset}>New deployment</button>
              </div>
            </div>
          )}
          {importResult?.repairs?.length > 0 && <div className="agent-repairs">
            <h3>Source repair actions</h3>
            <table><thead><tr><th>Component</th><th>Method</th><th>Cycle</th></tr></thead><tbody>
              {importResult.repairs.map((repair, index) => <tr key={index}><td>{repair.label} <span className="muted">({repair.componentId})</span></td><td>{repair.method}</td><td>{repair.cycle}</td></tr>)}
            </tbody></table>
          </div>}
        </div>
      )}
      {summaryExpanded && <FullscreenSummary value={description} onClose={() => setSummaryExpanded(false)} />}
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
              <div className={'pbar-fill ' + (s.status === 'error' ? 'err' : s.status === 'done' ? 'done' : '') + (pct === null && s.status === 'running' ? ' indet' : '')}
                style={pct !== null ? { width: pct + '%' } : (s.status === 'done' ? { width: '100%' } : undefined)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalyzeStep({ analysis, managed, onReveal }) {
  const insp = analysis.inspection || {};
  const deps = insp.dependencies || [];
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
          <div className="k">Type</div><div><TypePill managed={managed} /></div>
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
                <tr key={i}><td>{d.requiredSchema || '—'}</td><td className="muted">{d.requiredType}</td><td className="muted">{d.dependentType} {d.dependentSchema ? `· ${d.dependentSchema}` : ''}</td></tr>
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
