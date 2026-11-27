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
  store: 'Store artifact', agent: 'Deployment agent', import: 'Import to target', resolve: 'Find source components',
  repair: 'Add source dependencies', publishsource: 'Publish source customizations',
  approval: 'Wait for dependency approval',
  reexport: 'Re-export source', publish: 'Publish target customizations'
};
const STAGE_ORDER = ['version', 'export', 'analyze', 'store', 'agent', 'import', 'resolve', 'approval', 'repair', 'publishsource', 'reexport', 'publish'];

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

function filePackageIssues(item) {
  const issues = [];
  if (!item.artifact) issues.push('The ZIP file location is missing. Choose this ZIP again.');
  if (!item.solutionUniqueName) issues.push('The solution unique name is missing. Choose a ZIP containing solution.xml.');
  if (typeof item.version !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(item.version)) {
    issues.push(`${item.version ? `Found solution version “${item.version}”` : 'The solution version is missing'}. Existing ZIP versions must have three or four numeric parts, such as 1.0.67 or 1.0.67.0. Choose a ZIP containing a valid solution version.`);
  }
  if (typeof item.exportManaged !== 'boolean') issues.push('The managed or unmanaged type is missing. Choose this ZIP again.');
  return issues;
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

function QueueList({ items, statuses = {}, validationIssues = [], editable = false, onMove, onRemove, onVersion }) {
  return <ol className="deployment-queue" aria-label="Solution deployment order" aria-live="polite">
    {items.map((item, index) => <li key={item.solutionUniqueName} className={'queue-item ' + (statuses[index]?.status || '')}>
      <span className="queue-position" aria-label={`Position ${index + 1}`}>{index + 1}</span>
      <div className="queue-details">
        <b>{item.solution || item.solutionUniqueName}</b>
        <span className="muted">{item.solutionUniqueName}{item.analysis ? ` · ${item.analysis.inspection.managed ? 'Managed' : 'Unmanaged'}` : typeof item.exportManaged === 'boolean' ? ` · ${item.exportManaged ? 'Managed' : 'Unmanaged'}` : ''}</span>
        {item.artifact && <span className="muted package-source-url">{item.artifact}</span>}
        {validationIssues.filter(issue => issue.index === index).map(issue => <span key={issue.index} className="alert err">
          {issue.reasons.join(' ')}
        </span>)}
        {statuses[index] && <span>{statuses[index].status === 'done' ? '✔ ' : statuses[index].status === 'error' ? '✕ ' : ''}{statuses[index].message}</span>}
      </div>
      {editable && onVersion ? <label className="queue-version">New version
        <input aria-label={`New version for ${item.solutionUniqueName}`} value={item.version} onChange={event => onVersion(index, event.target.value)} />
      </label> : <span className="muted">v{item.version}</span>}
      {editable && <div className="queue-actions">
        <button type="button" className="btn small secondary" disabled={index === 0} aria-label={`Move ${item.solutionUniqueName} up`} onClick={() => onMove(index, -1)}>↑</button>
        <button type="button" className="btn small secondary" disabled={index === items.length - 1} aria-label={`Move ${item.solutionUniqueName} down`} onClick={() => onMove(index, 1)}>↓</button>
        <button type="button" className="btn small secondary" aria-label={`Remove ${item.solutionUniqueName}`} onClick={() => onRemove(index)}>Remove</button>
      </div>}
    </li>)}
  </ol>;
}

export default function DeployView({ account, envs, envLoading, envError, refreshEnvs, providers }) {
  const [mode, setMode] = useState('source'); // 'source' | 'file' | 'predefined'
  const [selectionMode, setSelectionMode] = useState('single');
  const multiple = mode === 'predefined' || selectionMode === 'multiple';
  const [library, setLibrary] = useState({ packages: [], folder: '', warnings: [] });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryMessage, setLibraryMessage] = useState('');
  const [packageChoice, setPackageChoice] = useState('');
  const [loadedPackage, setLoadedPackage] = useState(null);
  const sourceMode = mode === 'source' || (mode === 'predefined' && loadedPackage?.mode !== 'file');
  const [editingPackage, setEditingPackage] = useState(null);
  const [packageName, setPackageName] = useState('');
  const [packageDescription, setPackageDescription] = useState('');
  const libraryRequest = useRef(0);
  const [queueItems, setQueueItems] = useState([]);
  const [queueStatuses, setQueueStatuses] = useState({});
  const [queueResult, setQueueResult] = useState(null);
  const queueRequest = useRef('');
  const draftAccount = useRef(account?.homeAccountId);
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
  useEffect(() => api.deploy.onQueueProgress(data => {
    if (data.requestId !== queueRequest.current) return;
    setQueueStatuses(previous => ({ ...previous, [data.index]: { status: data.status, message: data.message } }));
    if (data.status === 'running') setProgress({});
  }), []);

  const selectedSolution = useMemo(() => solutions.find((s) => s.uniqueName === solutionName), [solutions, solutionName]);

  const loadSolutions = async (url) => {
    const request = ++solutionRequest.current;
    setSolLoading(true); setSolutions([]); setSolutionName(''); setQueueItems([]); setQueueStatuses({});
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
  const managed = sourceMode ? deployType === 'managed' : !!analysis?.inspection?.managed;
  const effectiveNotes = notes === null ? description : notes;

  const resetProgress = (keys) => setProgress((prev) => { const next = { ...prev }; keys.forEach((k) => delete next[k]); return next; });

  const canAnalyzeSource = sourceUrl && targetUrl && selectedSolution && !selectedSolution.isManaged && sourceUrl !== targetUrl;
  const canAnalyzeFile = targetUrl && filePath && analysis?.artifact === filePath;
  const canReviewQueue = targetUrl && queueItems.length >= (mode === 'predefined' || editingPackage ? 1 : 2) &&
    (mode !== 'predefined' || loadedPackage) && (!sourceMode ||
    (sourceUrl && sourceUrl !== targetUrl && queueItems.every(item => /^\d+\.\d+\.\d+\.\d+$/.test(item.version))));
  const packageItems = multiple ? queueItems : sourceMode
    ? selectedSolution ? [{ solutionUniqueName: selectedSolution.uniqueName, solution: selectedSolution.friendlyName }] : []
    : filePath && analysis?.artifact === filePath && analysis?.inspection ? [{ artifact: filePath, sha256: analysis.sha256,
      solutionUniqueName: analysis.inspection.uniqueName, solution: analysis.inspection.uniqueName,
      version: analysis.inspection.version, exportManaged: analysis.inspection.managed }] : [];
  const packageFileIssues = sourceMode ? [] : packageItems.map((item, index) => ({
    index, solution: item.solution || item.solutionUniqueName || 'Unnamed solution', reasons: filePackageIssues(item)
  })).filter(issue => issue.reasons.length);
  const packageSaveIssue = !packageName.trim() ? 'Enter a package name to save.'
    : sourceMode && !sourceUrl ? 'Choose a source environment to save.'
    : !packageItems.length ? sourceMode ? 'Select at least one solution to save.' : 'Choose at least one solution ZIP and wait for its details to load.'
    : packageFileIssues.length ? `Review ${packageFileIssues.length} solution${packageFileIssues.length === 1 ? '' : 's'} before saving.` : '';
  const canSavePackage = !packageSaveIssue;
  const changeSelection = value => {
    setEditingPackage(null); setLoadedPackage(null); setLibraryMessage('');
    setSelectionMode(value); setQueueItems([]); setQueueStatuses({}); setQueueResult(null);
    setAnalysis(null); setFilePath(''); setSolutionName(''); setNotes(null); setProgress({}); setError('');
  };
  const changeMode = value => {
    ++solutionRequest.current;
    setLoadedPackage(null); setEditingPackage(null); setLibraryMessage(''); setPackageChoice('');
    setSolLoading(false);
    setMode(value); setAnalysis(null); setFilePath(''); setQueueItems([]);
    setQueueStatuses({}); setQueueResult(null); setProgress({}); setError('');
    setSolutionName(''); setSolutions([]);
    if (value === 'source' && sourceUrl) loadSolutions(sourceUrl);
  };
  const changeDeployType = value => {
    if (value === deployType) return;
    setDeployType(value); setAnalysis(null); setQueueStatuses({}); setProgress({});
    setQueueItems(previous => previous.map(item => ({ ...item, analysis: undefined })));
  };
  const addQueueSolution = name => {
    const solution = solutions.find(item => item.uniqueName === name);
    if (!solution || queueItems.some(item => item.solutionUniqueName === name)) return;
    setQueueItems(previous => [...previous, { solutionUniqueName: name, solution: solution.friendlyName,
      solutionId: solution.solutionId, version: bumpVersion(solution.version) }]);
    setQueueStatuses({});
  };
  const moveQueueItem = (index, direction) => {
    setQueueItems(previous => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
    setQueueStatuses({});
  };
  const pickQueueFiles = async () => {
    const request = ++solutionRequest.current;
    setError(''); setBusy(true);
    try {
      const picked = await api.deploy.pickZip({ multiple: true });
      if (request !== solutionRequest.current) return;
      if (!picked.ok) return;
      const additions = [];
      const seen = new Set(queueItems.map(item => item.solutionUniqueName.toLowerCase()));
      for (const artifact of picked.paths) {
        const analysis = await api.deploy.inspectFile(artifact);
        if (request !== solutionRequest.current) return;
        if (!analysis.ok || !analysis.inspection?.uniqueName || !analysis.inspection.version) throw new Error(analysis.error || 'Choose solution ZIPs containing solution.xml.');
        const name = analysis.inspection.uniqueName;
        if (seen.has(name.toLowerCase())) throw new Error('This solution is already selected: ' + name);
        seen.add(name.toLowerCase());
        additions.push({ artifact, analysis, sha256: analysis.sha256, solutionUniqueName: name, solution: name,
          version: analysis.inspection.version, exportManaged: analysis.inspection.managed });
      }
      setQueueItems(previous => [...previous, ...additions]); setQueueStatuses({});
    } catch (error) { if (request === solutionRequest.current) setError(String(error.message || error)); }
    finally { if (request === solutionRequest.current) setBusy(false); }
  };
  const queueSnapshot = useAgent => ({
    requestId: queueRequest.current, mode: sourceMode ? 'source' : 'file', accountId: account?.homeAccountId,
    packageRef: mode === 'predefined' && loadedPackage ? { id: loadedPackage.id, hash: loadedPackage.hash } : undefined,
    sourceUrl: sourceMode ? sourceUrl : '', sourceEnv: sourceMode ? envName(envs, sourceUrl) : 'Package file',
    targetUrl, targetEnv: envName(envs, targetUrl), items: queueItems,
    exportManaged: sourceMode ? deployType === 'managed' : queueItems.every(item => item.exportManaged), overwrite: forceOverwrite, publishChanges,
    description, workItems, workItemDetails, workItemSummary: workSummary, notes: effectiveNotes,
    gitCommit, useAgent
  });
  const reviewQueue = async () => {
    setError(''); setQueueResult(null); setQueueStatuses({}); setProgress({});
    setBusy(true); queueRequest.current = crypto.randomUUID();
    try {
      const result = await api.deploy.prepareQueue(queueSnapshot(false));
      if (!result.ok) throw new Error(result.error || (sourceMode ? 'Could not export the queue.' : 'Could not review the ZIP files.'));
      setQueueItems(result.items); setStep('analyze');
    } catch (error) { setError(String(error.message || error)); }
    finally { setBusy(false); }
  };
  const runQueue = async useAgent => {
    setError(''); setQueueResult(null); setQueueStatuses({}); setProgress({}); setBusy(true);
    queueRequest.current = crypto.randomUUID();
    try {
      const result = await api.deploy.runQueue(queueSnapshot(useAgent));
      setQueueResult(result);
      if (!result.results?.length) setQueueStatuses(Object.fromEntries(queueItems.map((_, index) =>
        [index, { status: 'skipped', message: 'Not started. ' + (result.error || 'Queue could not start.') }])));
    } catch (error) {
      const message = String(error.message || error);
      setQueueResult({ ok: false, error: message });
      setQueueStatuses(Object.fromEntries(queueItems.map((_, index) => [index, { status: 'skipped', message: 'Not started. ' + message }])));
    }
    finally { setBusy(false); }
  };

  const refreshPackages = async () => {
    const request = ++libraryRequest.current;
    setLibraryLoading(true); setLibraryError('');
    try {
      const result = await api.packages.list();
      if (request !== libraryRequest.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not read the package library.');
      setLibrary(result);
      if (loadedPackage && !result.packages.some(recipe => recipe.id === loadedPackage.id && recipe.hash === loadedPackage.hash)) {
        clearLoadedPackage();
        setError('The saved package changed or was removed. Load its current definition before continuing.');
      }
    } catch (error) {
      if (request === libraryRequest.current) { setLibrary({ packages: [], folder: '', warnings: [] }); setLibraryError(error.message); }
    } finally { if (request === libraryRequest.current) setLibraryLoading(false); }
  };
  useEffect(() => {
    if (mode === 'predefined' && step === 'config') refreshPackages();
    return () => { ++libraryRequest.current; };
  }, [mode, step, account?.homeAccountId]);

  const clearLoadedPackage = () => {
    ++solutionRequest.current;
    setLoadedPackage(null); setQueueItems([]); setQueueStatuses({}); setQueueResult(null);
    setProgress({}); setAnalysis(null); setFilePath(''); setError(''); setSourceUrl(''); setSolLoading(false);
  };
  const loadPackage = async (edit = false, id = packageChoice) => {
    const recipe = library.packages.find(item => item.id === id);
    if (!recipe) return;
    const request = ++solutionRequest.current;
    setBusy(true); setSolLoading(true); setError(''); setQueueItems([]); setLoadedPackage(null); setLibraryMessage('');
    try {
      const result = await api.packages.load({ id: recipe.id, hash: recipe.hash, accountId: account?.homeAccountId, edit });
      if (request !== solutionRequest.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not load the saved package.');
      setSourceUrl(result.package.sourceUrl); setDeployType(result.package.exportManaged ? 'managed' : 'unmanaged');
      setQueueItems(result.items); setQueueStatuses({}); setQueueResult(null); setAnalysis(null); setFilePath(''); setProgress({});
      if (targetUrl === result.package.sourceUrl) setTargetUrl('');
      if (edit) {
        setMode(result.package.mode === 'file' ? 'file' : 'source'); setSelectionMode('multiple'); setEditingPackage(result.package);
        setPackageName(result.package.name); setPackageDescription(result.package.description);
        setSolutions(result.solutions || []);
        if (result.package.mode === 'file') setLibraryMessage('Reorder the saved ZIPs below. To replace moved or changed files, remove their entries and choose the ZIPs again before saving.');
      } else { setLoadedPackage(result.package); setEditingPackage(null); }
    } catch (error) { if (request === solutionRequest.current) setError(error.message || 'Could not load the package.'); }
    finally { if (request === solutionRequest.current) { setBusy(false); setSolLoading(false); } }
  };
  const savePackage = async (asNew = false) => {
    if (busy || !canSavePackage) return;
    const request = solutionRequest.current;
    setBusy(true); setLibraryError(''); setLibraryMessage(sourceMode ? 'Saving package…' : 'Checking ZIP files and saving package…');
    try {
      const result = await api.packages.save({
        ...(editingPackage && !asNew ? { id: editingPackage.id, expectedHash: editingPackage.hash } : {}),
        mode: sourceMode ? 'source' : 'file',
        name: packageName, description: packageDescription, sourceUrl, sourceEnv: envName(envs, sourceUrl),
        exportManaged: deployType === 'managed', items: packageItems
      });
      if (request !== solutionRequest.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not save the package.');
      if (!sourceMode) {
        if (multiple) setQueueItems(previous => previous.map((item, index) => ({ ...item, ...result.items[index] })));
        else setAnalysis(previous => ({ ...previous, sha256: result.items[0].sha256 }));
      }
      setEditingPackage(result); setLibraryMessage(`“${result.name}” saved. Choose Predefined packages to load it later.`);
    } catch (error) { if (request === solutionRequest.current) { setLibraryMessage(''); setLibraryError(error.message); } }
    finally { if (request === solutionRequest.current) setBusy(false); }
  };
  const chooseLibraryFolder = async () => {
    const actionAccount = account?.homeAccountId;
    setBusy(true); setLibraryError(''); setLibraryMessage('');
    try {
      const result = await api.packages.chooseFolder();
      if (actionAccount !== draftAccount.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not choose the package library folder.');
      if (result.canceled) return;
      clearLoadedPackage(); setPackageChoice('');
      await refreshPackages();
    } catch (error) { if (actionAccount === draftAccount.current) setLibraryError(error.message); }
    finally { if (actionAccount === draftAccount.current) setBusy(false); }
  };
  const removePackage = async () => {
    const recipe = library.packages.find(item => item.id === packageChoice);
    if (!recipe || !window.confirm(`Remove “${recipe.name}” from this package library? Deployment history and solution files will remain.`)) return;
    const actionAccount = account?.homeAccountId;
    setBusy(true); setLibraryError('');
    try {
      const result = await api.packages.remove({ id: recipe.id, hash: recipe.hash });
      if (actionAccount !== draftAccount.current) return;
      if (!result.ok) throw new Error(result.error || 'Could not remove the package.');
      clearLoadedPackage(); setPackageChoice(''); await refreshPackages();
      if (actionAccount === draftAccount.current) setLibraryMessage('Package definition removed.');
    } catch (error) { if (actionAccount === draftAccount.current) setLibraryError(error.message); }
    finally { if (actionAccount === draftAccount.current) setBusy(false); }
  };

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
    const request = ++solutionRequest.current;
    setError(''); setBusy(true);
    try {
      const r = await api.deploy.pickZip();
      if (request !== solutionRequest.current || !r.ok) return;
      setAnalysis(null); setFilePath(r.path);
      const insp = await api.deploy.inspectFile(r.path);
      if (request !== solutionRequest.current) return;
      if (!insp.ok || !insp.inspection?.uniqueName || !insp.inspection.version) {
        throw new Error(insp.error || 'Choose a solution ZIP containing solution.xml.');
      }
      setAnalysis(insp);
    } catch (error) { if (request === solutionRequest.current) setError(error.message || 'Could not read package.'); }
    finally { if (request === solutionRequest.current) setBusy(false); }
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
        targetEnvName: envName(envs, targetUrl),
        sourceEnvUrl: mode === 'source' ? sourceUrl : '', sourceEnvName: mode === 'source' ? envName(envs, sourceUrl) : 'Package file',
        solutionUniqueName: mode === 'source' ? solutionName : analysis.inspection?.uniqueName,
        version: mode === 'source' ? version : analysis.inspection?.version, description, notes: effectiveNotes,
        solutionName: mode === 'file' ? (analysis?.inspection?.uniqueName || filePath.split(/[\\/]/).pop()) : (selectedSolution?.friendlyName || solutionName),
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
        notes: effectiveNotes, status: r.ok ? 'success' : 'failed', warning: [r.warning, analysis.stored?.warning].filter(Boolean).join(' ') || null, error: r.ok ? null : r.error,
        importCompleted: r.importCompleted, importJobId: r.importJobId, phase: r.phase,
        runId: r.runId, reporting: r.reporting, teamsNotifications: r.teamsNotifications, teams: r.teams
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
    // A new deployment starts with a clean configuration as well as a clean result.
    ++solutionRequest.current;
    ++libraryRequest.current;
    setLoadedPackage(null); setEditingPackage(null); setPackageChoice('');
    setPackageName(''); setPackageDescription(''); setLibraryError(''); setLibraryMessage(''); setLibraryLoading(false);
    ++workRequest.current;
    clearTimeout(workTimer.current);
    workTimer.current = null;
    setMode('source');
    setSelectionMode('single'); setQueueItems([]); setQueueStatuses({}); setQueueResult(null); queueRequest.current = '';
    setStep('config'); setAnalysis(null); setNotes(null); setNotesWarning('');
    setImportResult(null); setRecord(null); setError(''); setProgress({}); setFilePath('');
    setSourceUrl(''); setTargetUrl(''); setSolutions([]); setSolLoading(false);
    setSolutionName(''); setVersion(''); setDeployType('managed');
    setPublishChanges(true); setForceOverwrite(true); setGitCommit(false);
    setDescription(''); setWorkItems(''); setWorkItemDetails(null); setWorkItemError('');
    setWorkItemLoading(false); setWorkItemProgress(null); setWorkSummary('');
    setSummaryExpanded(false); setSummaryBusy(false); setSummaryProgress(null);
    setBusy(false); setGenBusy(false);
  };

  useEffect(() => {
    if (draftAccount.current !== account?.homeAccountId) {
      draftAccount.current = account?.homeAccountId;
      reset();
    }
  }, [account?.homeAccountId]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const activeStages = STAGE_ORDER.filter((k) => progress[k]);

  return (
    <div>
      <p className="h1">Deploy solutions</p>
      <p className="sub">Move Dataverse solutions between environments — as managed or unmanaged — with dependency review, versioning and deployment notes.</p>

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
          <fieldset className="deployment-fields" disabled={busy}>
          <div className="seg" style={{ marginBottom: 16 }}>
            <button aria-pressed={mode === 'source'} className={mode === 'source' ? 'on' : ''} onClick={() => changeMode('source')}>From source environment</button>
            <button aria-pressed={mode === 'file'} className={mode === 'file' ? 'on' : ''} onClick={() => changeMode('file')}>Deploy existing package (.zip)</button>
            <button aria-pressed={mode === 'predefined'} className={mode === 'predefined' ? 'on' : ''} onClick={() => changeMode('predefined')}>Predefined packages</button>
          </div>
          {mode !== 'predefined' && <><label>Solutions to deploy</label>
          <div className="seg" role="group" aria-label="Number of solutions" style={{ marginBottom: 16 }}>
            <button aria-pressed={!multiple} className={!multiple ? 'on' : ''} onClick={() => changeSelection('single')}>Single solution</button>
            <button aria-pressed={multiple} className={multiple ? 'on' : ''} onClick={() => changeSelection('multiple')}>Multiple solutions</button>
          </div></>}

          {mode === 'predefined' && <section className="package-library" aria-labelledby="package-library-title">
            <div className="toolbar">
              <div style={{ flex: 1 }}><h3 id="package-library-title">Saved package library</h3><p className="muted">Load saved source solutions or existing ZIP files in their saved import order.</p></div>
              <button className="btn small secondary" disabled={libraryLoading} onClick={refreshPackages}>Refresh packages</button>
            </div>
            <div className="package-folder">
              <span className="muted">Library folder</span><span>{library.folder || 'Your configured package folder'}</span>
              <div className="toolbar">
                <button className="btn small secondary" onClick={chooseLibraryFolder}>Choose folder…</button>
                {library.folder && <button className="btn small secondary" onClick={() => api.util.revealPath(library.folder).catch(error => setLibraryError(error.message))}>Show folder</button>}
              </div>
            </div>
            <p className="muted">Source packages export current solutions when you review or deploy. ZIP packages remember existing file locations, versions, types and order; files stay in their original locations. Other computers need the definitions and access to every referenced ZIP.</p>
            {libraryLoading && <p role="status">Loading saved packages…</p>}
            {solLoading && <p role="status">Loading and checking the package’s solutions in saved order…</p>}
            {library.warnings.map(warning => <div key={warning} className="alert warn">{warning}</div>)}
            <label htmlFor="predefined-package">Package</label>
            <select id="predefined-package" value={packageChoice} disabled={libraryLoading} onChange={event => {
              const id = event.target.value;
              setPackageChoice(id); clearLoadedPackage(); setLibraryMessage('');
              if (id) loadPackage(false, id);
            }}>
              <option value="">Choose a saved package…</option>
              {library.packages.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.name} · {recipe.items.length} solutions · {new Date(recipe.updatedAt).toLocaleString()}</option>)}
            </select>
            {!libraryLoading && !library.packages.length && !libraryError && <p className="muted">No packages saved yet. Choose From source environment or Deploy existing package (.zip), select solutions, arrange their order, and save a named package.</p>}
            {packageChoice && (() => {
              const recipe = library.packages.find(item => item.id === packageChoice);
              return recipe ? <div className="package-preview">
                <h3>{recipe.name}</h3>
                {recipe.description && <p>{recipe.description}</p>}
                <p><strong>Source:</strong> {recipe.mode === 'file' ? 'Existing solution ZIPs' : recipe.sourceEnv || recipe.sourceUrl}</p>
                {recipe.sourceUrl && <p className="muted package-source-url">{recipe.sourceUrl}</p>}
                <p><strong>Type:</strong> {recipe.mode === 'file' ? 'Each ZIP keeps its managed or unmanaged type' : recipe.exportManaged ? 'Managed' : 'Unmanaged'}</p>
                <ol aria-label="Saved solution order">{recipe.items.map(item => <li key={item.solutionUniqueName}>
                  {item.solution} <span className="muted">({item.solutionUniqueName})</span>
                  {recipe.mode === 'file' && <><span> · v{item.version} · {item.exportManaged ? 'Managed' : 'Unmanaged'}</span><div className="muted package-source-url">{item.artifact}</div></>}
                </li>)}</ol>
                <div className="toolbar">
                  <button className="btn" disabled={libraryLoading} onClick={() => loadPackage()}>{loadedPackage?.id === recipe.id ? recipe.mode === 'file' ? 'Recheck ZIP files' : 'Refresh source versions' : 'Load package'}</button>
                  <button className="btn secondary" disabled={libraryLoading} onClick={() => loadPackage(true)}>Edit package</button>
                  <button className="btn secondary" disabled={libraryLoading} onClick={removePackage}>Remove definition</button>
                </div>
              </div> : <p className="alert warn">This package is no longer listed. Refresh packages and choose it again.</p>;
            })()}
          </section>}
          {mode === 'predefined' && libraryError && <div className="alert err" role="alert">{libraryError}</div>}
          {mode === 'predefined' && libraryMessage && <div className="alert info" role="status">{libraryMessage}</div>}

          <div className="toolbar">
            <h3 style={{ margin: 0, flex: 1 }}>Configure deployment {envLoading && <span className="spin" />}</h3>
            <button className="btn small secondary" onClick={refreshEnvs}>Refresh envs</button>
          </div>
          {envError && <div className="alert warn">{envError}</div>}

          {sourceMode ? (
            <>
              <div className="row">
                <div className="col">
                  <label>Source environment</label>
                  {mode === 'predefined' ? <input readOnly value={loadedPackage ? `${loadedPackage.sourceEnv || loadedPackage.sourceUrl}` : ''} placeholder="Load a saved package first" /> : <select value={sourceUrl} onChange={(e) => onSource(e.target.value)}>
                    <option value="">Select source…</option>
                    {sourceUrl && !envs.some(e => e.environmentUrl === sourceUrl) && <option value={sourceUrl}>{sourceUrl}</option>}
                    {envs.map((e) => <option key={e.environmentUrl} value={e.environmentUrl}>{e.displayName}</option>)}
                  </select>}
                </div>
                <div className="col">
                  <label>Target environment</label>
                  <select value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}>
                    <option value="">Select target…</option>
                    {envs.filter((e) => e.environmentUrl !== sourceUrl).map((e) => <option key={e.environmentUrl} value={e.environmentUrl}>{e.displayName}</option>)}
                  </select>
                </div>
              </div>
              {mode === 'source' && <div className="row" style={{ marginTop: 14 }}>
                <div className="col">
                  <label htmlFor="solution-search">{multiple ? 'Add unmanaged source solutions' : 'Unmanaged source solution'} {solLoading && <span className="spin" />}</label>
                  <SolutionCombobox key={`${sourceUrl}-${selectionMode}`} solutions={multiple ? solutions.filter(solution => !queueItems.some(item => item.solutionUniqueName === solution.uniqueName)) : solutions} selected={multiple ? null : selectedSolution} onSelect={multiple ? addQueueSolution : setSolutionName} disabled={!sourceUrl || solLoading} loading={solLoading} />
                  <p className="muted" style={{ margin: '6px 0 0' }}>{multiple ? 'Choose solutions one at a time, then arrange their import order below.' : 'Only unmanaged source solutions are listed. You can export one as a managed or unmanaged package below.'}</p>
                </div>
                {!multiple &&
                <div className="col" style={{ maxWidth: 200 }}>
                  <label>New version {selectedSolution ? `(was ${selectedSolution.version})` : ''}</label>
                  <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0.1" />
                </div>}
              </div>}

              <div style={{ marginTop: 14 }}>
                <label>Deploy as</label>
                {mode === 'predefined' ? <TypePill managed={deployType === 'managed'} /> : <div className="seg">
                  <button className={deployType === 'managed' ? 'on' : ''} onClick={() => changeDeployType('managed')}>Managed (recommended)</button>
                  <button className={deployType === 'unmanaged' ? 'on' : ''} onClick={() => changeDeployType('unmanaged')}>Unmanaged</button>
                </div>}
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
                  <label>{multiple ? 'Solution packages (.zip)' : 'Solution package (.zip)'}</label>
                  <div className="row" style={{ alignItems: 'center' }}>
                    <input readOnly value={multiple ? (queueItems.length ? `${queueItems.length} solutions selected` : '') : filePath ? filePath.split(/[\\/]/).pop() : ''} placeholder="No file selected" />
                    {mode !== 'predefined' && <button className="btn secondary" style={{ maxWidth: 150 }} onClick={multiple ? pickQueueFiles : pickFile}>{busy ? <span className="spin" /> : multiple ? 'Choose ZIPs…' : 'Choose…'}</button>}
                  </div>
                </div>
              </div>
              {analysis?.inspection && (
                <div className="alert info" style={{ marginTop: 12 }}>
                  Package: <b>{analysis.inspection.uniqueName || '—'}</b> v{analysis.inspection.version || '—'} · <TypePill managed={analysis.inspection.managed} /> · {analysis.inspection.dependencies?.length || 0} dependencies
                </div>
              )}
              <p className="muted" style={{ marginTop: 8 }}>
                {mode === 'predefined' ? 'The saved ZIPs will import in the order below. Use Edit package to change files or their order.' : 'Select existing solution ZIPs, including packages the app exported earlier. You can save their locations and import order as a predefined package below.'}
              </p>
            </>
          )}

          {multiple && <section style={{ marginTop: 20 }}>
            <h3>{loadedPackage ? `${loadedPackage.name} · Solution import order` : 'Solution import order'}</h3>
            <p className="muted">{mode === 'predefined' ? sourceMode ? 'Current source versions are shown below. The saved order and type are kept for this deployment; use Edit package to change the definition.' : 'Saved ZIP versions, file locations and order are shown below. Use Edit package to change the definition.' : 'Put required solutions first. Each import finishes, including Microsoft ribbon installation, before the next starts.'}</p>
            <QueueList items={queueItems} statuses={queueStatuses} validationIssues={mode === 'file' ? packageFileIssues : []} editable={mode !== 'predefined'} onMove={moveQueueItem}
              onRemove={index => { setQueueItems(previous => previous.filter((_, position) => position !== index)); setQueueStatuses({}); }}
              onVersion={mode === 'source' ? (index, value) => { setQueueStatuses({}); setQueueItems(previous => previous.map((item, position) => position === index ? { ...item, version: value, analysis: undefined } : item)); } : undefined} />
          </section>}

          {mode !== 'predefined' && <section className="package-save" aria-labelledby="package-save-title">
            <h3 id="package-save-title">{editingPackage ? 'Update saved package' : 'Save as a predefined package'}</h3>
            <p className="muted">{sourceMode ? 'Save this source, solution order and deployment type for future use. The target, ZIPs and version edits are not saved; loading a package uses current source versions.' : 'Save the selected ZIP file locations, versions, types and import order for future use. ZIPs stay in their original locations. Keep them accessible; moved or changed files must be selected and saved again. A target is not needed to save.'}</p>
            <div className="row">
              <div className="col"><label htmlFor="package-name">Package name</label><input id="package-name" maxLength={100} value={packageName} onChange={event => setPackageName(event.target.value)} placeholder="e.g. PREXA" /></div>
              <div className="col"><label htmlFor="package-description">Package description (optional)</label><input id="package-description" maxLength={2000} value={packageDescription} onChange={event => setPackageDescription(event.target.value)} /></div>
            </div>
            <div className="toolbar">
              <button className="btn secondary" disabled={busy || !canSavePackage} aria-describedby="package-save-status" onClick={() => savePackage()}>{editingPackage ? 'Save changes' : 'Save package'}</button>
              {editingPackage && <button className="btn secondary" disabled={busy || !canSavePackage} aria-describedby="package-save-status" onClick={() => savePackage(true)}>Save as new package</button>}
              <button className="btn small secondary" onClick={() => changeMode('predefined')}>Open package library</button>
            </div>
            <div id="package-save-status" aria-live="polite">
              {packageSaveIssue && <p className="muted">{packageSaveIssue}</p>}
              {!!packageFileIssues.length && <ul>{packageFileIssues.map(issue => <li key={issue.index}>
                <strong>Solution {issue.index + 1}: {issue.solution}</strong>
                <ul>{issue.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
              </li>)}</ul>}
              {libraryError && <div className="alert err" role="alert">{libraryError}</div>}
              {libraryMessage && <div className="alert info" role="status">{libraryMessage}</div>}
            </div>
          </section>}

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
            <Checkbox label="Publish after import" checked={publishChanges} onChange={setPublishChanges} disabled={multiple ? (sourceMode ? deployType === 'managed' : queueItems.every(item => item.exportManaged)) : managed} />
            <Checkbox label="Overwrite unmanaged customizations" checked={forceOverwrite} onChange={setForceOverwrite} />
          </div>

          <div className="right">
            {multiple ? <>
              <button className="btn secondary" disabled={!canReviewQueue || busy} onClick={reviewQueue}>{busy ? <span className="spin" /> : sourceMode ? 'Export & review queue →' : 'Review queue →'}</button>
              {sourceMode && <button className="btn agent-button" disabled={!canReviewQueue || busy} onClick={() => { setQueueResult(null); setProgress({}); setStep('deploy'); }}>Continue with agent →</button>}
            </> : mode === 'source' ? (
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
          </fieldset>
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
        </div>
      )}

      {step === 'analyze' && multiple && <>
        <div className="card">
          <h3>Review deployment queue</h3>
          <QueueList items={queueItems} />
          <p className="muted">Imports run in this order. Open each package below to review its components and dependencies.</p>
        </div>
        {queueItems.map(item => <details key={item.solutionUniqueName} className="queue-review">
          <summary>{item.solution || item.solutionUniqueName} · v{item.version}</summary>
          <AnalyzeStep analysis={item.analysis} managed={item.analysis.inspection.managed} onReveal={() => api.util.revealPath(item.analysis.artifact)} />
        </details>)}
        <div className="card">
          <h3>Deployment notes</h3>
          <label htmlFor="queue-notes">Saved with each solution in this queue</label>
          <textarea id="queue-notes" value={effectiveNotes} onChange={event => setNotes(event.target.value)} />
          <div className="right">
            <button className="btn secondary" onClick={() => setStep('config')}>← Back</button>
            <button className="btn" onClick={() => { setQueueResult(null); setQueueStatuses({}); setProgress({}); setStep('deploy'); }}>Continue to deploy →</button>
          </div>
        </div>
      </>}

      {step === 'analyze' && !multiple && analysis && (
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

      {step === 'deploy' && multiple && <div className="card">
        <h3>Deploy {loadedPackage?.name || 'queue'} to {envName(envs, targetUrl)}</h3>
        <p className="muted">{sourceMode ? loadedPackage?.sourceEnv || envName(envs, sourceUrl) : 'Package files'} → {envName(envs, targetUrl)} · {queueItems.length} solutions</p>
        <QueueList items={queueItems} statuses={queueStatuses} />
        <p className="muted">Uses your signed-in Microsoft account. Each selected solution's import is tracked separately. If Microsoft background solution or ribbon installation is detected, the queue checks every 10 seconds and waits up to 15 minutes before continuing. A failure stops the queue.</p>
        {!queueResult && <>
          <label htmlFor="queue-deploy-notes">Deployment notes</label>
          <textarea id="queue-deploy-notes" disabled={busy} value={effectiveNotes} onChange={event => setNotes(event.target.value)} />
          <Checkbox label="Commit artifacts + notes to local git" checked={gitCommit} onChange={setGitCommit} disabled={busy} />
          <div className="right deploy-actions">
            <button className="btn secondary" disabled={busy} onClick={() => setStep(queueItems.every(item => item.analysis) ? 'analyze' : 'config')}>← Back</button>
            {sourceMode && <button className="btn agent-button" disabled={busy || !canReviewQueue} onClick={() => runQueue(true)}>Deploy queue with agent</button>}
            {queueItems.every(item => item.analysis) && <button className="btn" disabled={busy || !canReviewQueue} onClick={() => runQueue(false)}>{busy ? <span className="spin" /> : 'Import queue to target'}</button>}
          </div>
        </>}
        {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
        {queueResult && <div className={'alert ' + (queueResult.ok ? 'info' : 'err')}>
          <b>{queueResult.ok ? '✔ Deployment queue completed' : '✕ Deployment queue stopped'}</b>
          <p>{queueResult.completed || 0} of {queueResult.total || queueItems.length} solutions completed.</p>
          {!queueResult.ok && <>
            <p><strong>Reason:</strong> {queueResult.error}</p>
            <p>Remaining solutions were not started.</p>
          </>}
          {queueResult.results?.filter(result => !result.ok && result.importCompleted).map(result => <p key={result.solutionUniqueName}>{result.solutionUniqueName} was imported, but the installation check failed. Check its target status before deploying it again.</p>)}
          {queueResult.results?.filter(result => result.warning).map(result => <p key={result.solutionUniqueName}>{result.solutionUniqueName}: {result.warning}</p>)}
          {queueResult.warning && <p><strong>History warning:</strong> {queueResult.warning}</p>}
          <div className="right"><button className="btn small" onClick={reset}>New deployment</button></div>
        </div>}
      </div>}

      {step === 'deploy' && !multiple && (
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
          {mode === 'source' && !importResult && <p className="muted agent-help">The agent imports and reads missing dependencies from a failed target import. It requests approval for the exact source additions, then uses the repair connection selected in Settings, publishes, re-exports and retries for up to five repair cycles. Enable and configure dependency approval in Settings before using repairs. Package dependency warnings alone do not trigger repairs. Your route, work items, description and notes stay selected.</p>}
          {(busy || activeStages.length > 0) && <ProgressPanel stages={activeStages} progress={progress} />}
          {importResult && (
            <div className={'alert ' + (importResult.ok ? 'info' : 'err')} style={{ marginTop: 14 }}>
              {importResult.ok ? (record ? '✔ Import completed and recorded in history.' : '✔ Import completed; history could not be saved.') : (importResult.agent ? '✖ Agent stopped: ' : '✖ Import failed: ') + (importResult.error || '')}
              {(record?.warning || importResult.warning) && <p>{record?.warning || importResult.warning}</p>}
              {!importResult.ok && importResult.importCompleted && <p>The solution import completed, but the installation check failed. Check its target status before deploying it again.</p>}
              {importResult.attempts?.length > 0 && <p>Import attempts: {importResult.attempts.length}. Source components added: {importResult.repairs?.length || 0}.</p>}
              {importResult.dependencies?.length > 0 && <p>Failed-import dependencies: {importResult.dependencies.map((item) => `${item.requiredSchema || item.requiredId || item.requiredType} (type ${item.requiredTypeCode || '?'}${item.requiredId ? ', ID ' + item.requiredId : ', no ID'})`).join(', ')}</p>}
              {importResult.importLog && <details><summary>View Dataverse import log</summary><pre className="log">{importResult.importLog}</pre></details>}
              <div className="right">
                {record?.notesFile && <button className="btn small secondary" onClick={() => api.util.revealPath(record.notesFile)}>Open notes file</button>}
                {!importResult.ok && !importResult.importCompleted && <button className="btn small secondary" onClick={() => { setImportResult(null); setRecord(null); resetProgress(STAGE_ORDER); }}>Retry with these details</button>}
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
        {stored.warning && <div className="alert warn" style={{ marginTop: 12 }}>{stored.warning}</div>}
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
