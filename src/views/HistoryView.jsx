import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import WorkItemDetails from '../components/WorkItemDetails.jsx';

export default function HistoryView() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [period, setPeriod] = useState('all');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const viewButton = useRef(null);

  const load = async () => {
    try { setItems(await api.history.list()); setError(''); }
    catch (e) { setError(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const sourceOptions = useMemo(() => [...new Map(items.filter((item) => item.sourceEnv).map((item) => [item.sourceUrl || item.sourceEnv, { id: item.sourceUrl || item.sourceEnv, label: item.sourceEnv }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [items]);
  const targetOptions = useMemo(() => [...new Map(items.filter((item) => item.targetEnv).map((item) => [item.targetUrl || item.targetEnv, { id: item.targetUrl || item.targetEnv, label: item.targetEnv }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [items]);
  const filtered = useMemo(() => {
    const now = new Date();
    let since = null;
    if (period === 'day') since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      since.setDate(since.getDate() - ((since.getDay() + 6) % 7));
    }
    if (period === 'month') since = new Date(now.getFullYear(), now.getMonth(), 1);
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => (!since || new Date(item.createdAt) >= since)
      && (!source || (item.sourceUrl || item.sourceEnv) === source)
      && (!target || (item.targetUrl || item.targetEnv) === target)
      && (!status || item.status === status)
      && (!needle || `${item.solution} ${item.solutionUniqueName || ''} ${item.workItems || ''}`.toLocaleLowerCase().includes(needle)));
  }, [items, period, source, target, status, query]);
  const selected = items.find((item) => item.id === selectedId);

  const exportItems = async (format) => {
    setError(''); setMessage(null); setExporting(true);
    try {
      const result = await api.history.export(filtered.map((item) => item.id), format);
      if (result.ok) setMessage({ text: `Exported ${result.count} record${result.count === 1 ? '' : 's'} as ${format.toUpperCase()}.`, path: result.path });
      else if (!result.canceled) setError(result.error || 'Could not export history.');
    } catch (e) { setError(String(e.message || e)); }
    finally { setExporting(false); }
  };
  const deleteItems = async (ids) => {
    if (!ids.length || !window.confirm(`Delete ${ids.length} history record${ids.length === 1 ? '' : 's'}? Exported solution packages and notes files will remain on disk.`)) return;
    setError(''); setMessage(null);
    try {
      const result = await api.history.delete(ids);
      setSelectedId('');
      await load();
      setMessage({ text: `Deleted ${result.deleted} history record${result.deleted === 1 ? '' : 's'}.` });
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="history-page">
      <div className="toolbar history-heading">
        <div style={{ flex: 1 }}>
          <p className="h1" style={{ margin: 0 }}>Deployment history</p>
          <p className="sub" style={{ margin: 0 }}>Every env-to-env deployment, with notes and dependencies.</p>
        </div>
        <button className="btn small secondary" onClick={load}>Refresh</button>
      </div>

      <div className="history-stats" aria-label="Deployment summary">
        <div><span>All deployments</span><strong>{items.length}</strong></div>
        <div><span>Successful</span><strong>{items.filter((item) => item.status === 'success').length}</strong></div>
        <div><span>Failed</span><strong>{items.filter((item) => item.status === 'failed').length}</strong></div>
      </div>

      <div className="card history-filters">
        <h3>Find deployments</h3>
        <div className="filter-grid">
          <div><label htmlFor="history-period">Period</label><select id="history-period" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">All time</option><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></select></div>
          <div><label htmlFor="history-source">Source environment</label><select id="history-source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">Any source</option>{sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}{option.id !== option.label ? ` · ${option.id}` : ''}</option>)}</select></div>
          <div><label htmlFor="history-target">Target environment</label><select id="history-target" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Any target</option>{targetOptions.map((option) => <option key={option.id} value={option.id}>{option.label}{option.id !== option.label ? ` · ${option.id}` : ''}</option>)}</select></div>
          <div><label htmlFor="history-status">Status</label><select id="history-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Any status</option><option value="success">Success</option><option value="failed">Failed</option><option value="pending">Pending</option></select></div>
          <div><label htmlFor="history-query">Solution or work item</label><input id="history-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history…" /></div>
        </div>
        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <span className="muted" style={{ flex: 1 }}>{filtered.length} of {items.length} deployments</span>
          <button className="btn small secondary" disabled={!filtered.length || exporting} onClick={() => exportItems('csv')}>Export CSV</button>
          <button className="btn small secondary" disabled={!filtered.length || exporting} onClick={() => exportItems('json')}>Export JSON</button>
          <button className="btn small danger" disabled={!filtered.length || exporting} onClick={() => deleteItems(filtered.map((item) => item.id))}>Delete filtered</button>
        </div>
      </div>
      {error && <div className="alert err" role="alert">{error}</div>}
      {message && <div className="alert info history-message" role="status"><span>{message.text}</span>{message.path && <button className="btn small secondary" onClick={() => api.util.revealPath(message.path).catch((e) => setError(String(e.message || e)))}>Show file</button>}<button className="history-dismiss" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div>}

      {items.length === 0 ? (
        <div className="card"><div className="empty">No deployments yet.</div></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No deployments match these filters.</div></div>
      ) : (
        <div className="card history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Solution</th>
                <th>Type</th>
                <th>Version</th>
                <th>Source → Target</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                  <td>{d.solution} {d.deploymentMethod === 'agent' && <span className="pill ok">Agent</span>}</td>
                  <td><span className={'pill ' + (d.exportManaged ? 'managed' : 'unmanaged')}>{d.exportManaged ? 'Managed' : 'Unmanaged'}</span></td>
                  <td className="muted">{d.version}</td>
                  <td className="muted">{d.sourceEnv} → {d.targetEnv}</td>
                  <td>
                    <span className={'pill ' + (d.status === 'success' ? 'ok' : d.status === 'failed' ? 'bad' : 'muted')}>
                      {d.status}
                    </span>
                  </td>
                  <td className="history-row-actions"><button className="btn small secondary" onClick={(event) => { viewButton.current = event.currentTarget; setSelectedId(d.id); }}>View</button>{' '}<button className="btn small danger" onClick={() => deleteItems([d.id])}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <Detail d={selected} returnFocus={viewButton} onClose={() => setSelectedId('')} />}
    </div>
  );
}

function Detail({ d, onClose, returnFocus }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); returnFocus.current?.focus(); };
  }, []);
  const deps = d.dependencies || [];
  return (
    <dialog ref={dialogRef} className="history-dialog" aria-labelledby="history-detail-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="history-dialog-head">
        <div><span className="eyebrow">DEPLOYMENT DETAILS</span><h2 id="history-detail-title">{d.solution} · v{d.version}</h2></div>
        <button className="btn small secondary" autoFocus onClick={onClose}>Close</button>
      </div>
      <div className="history-dialog-body">
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="k">When</div><div>{new Date(d.createdAt).toLocaleString()}</div>
        <div className="k">Route</div><div>{d.sourceEnv} → {d.targetEnv}</div>
        <div className="k">Type</div><div>{d.exportManaged ? 'Managed' : 'Unmanaged'}</div>
        <div className="k">Deployment method</div><div>{d.deploymentMethod === 'agent' ? 'Agent' : 'Manual import'}</div>
        <div className="k">Status</div>
        <div><span className={'pill ' + (d.status === 'success' ? 'ok' : 'bad')}>{d.status}</span></div>
        <div className="k">Account</div><div className="muted">{d.account || '—'}</div>
        <div className="k">Stored</div>
        <div>
          {d.stored?.storage === 'onedrive'
            ? <button className="btn small secondary" onClick={() => api.util.openExternal(d.stored.oneDriveUrl)}>Open in OneDrive</button>
            : d.stored?.storedPath
              ? <button className="btn small secondary" onClick={() => api.util.revealPath(d.stored.storedPath)}>Reveal file</button>
              : (d.artifact ? <button className="btn small secondary" onClick={() => api.util.revealPath(d.artifact)}>Reveal .zip</button> : '—')}
        </div>
      </div>
      {d.workItems && (
        <>
          <label>Work items</label>
          <div className="notes" style={{ marginBottom: 14 }}>{d.workItems}</div>
        </>
      )}
      {d.workItemDetails?.items?.length > 0 && <><label>Azure DevOps work items</label><WorkItemDetails details={d.workItemDetails} /></>}

      {d.error && <div className="alert err">{d.error}</div>}
      {d.warning && <div className="alert warn">{d.warning}</div>}
      {d.agent && <>
        <label>Agent activity</label>
        <p className="muted">{d.agent.attempts?.length || 0} import attempt(s), {d.agent.repairs?.length || 0} source component(s) added.</p>
        {d.agent.repairs?.length > 0 && <table style={{ marginBottom: 14 }}><thead><tr><th>Component</th><th>Method</th><th>Cycle</th></tr></thead><tbody>
          {d.agent.repairs.map((repair, index) => <tr key={index}><td>{repair.label}</td><td>{repair.method}</td><td>{repair.cycle}</td></tr>)}
        </tbody></table>}
        {d.agent.failedDependencies?.length > 0 && <p className="muted">Reported by target import: {d.agent.failedDependencies.map((item) => `${item.requiredSchema || item.requiredId || item.requiredType} (type ${item.requiredTypeCode || '?'}${item.requiredId ? ', ID ' + item.requiredId : ', no ID'})`).join(', ')}</p>}
        {d.agent.importLog && <details style={{ marginBottom: 14 }}><summary>View Dataverse import log</summary><pre className="log">{d.agent.importLog}</pre></details>}
      </>}

      {d.description && (
        <>
          <label>Change description</label>
          <div className="notes" style={{ marginBottom: 14 }}>{d.description}</div>
        </>
      )}

      {deps.length > 0 && (
        <>
          <label>Dependencies ({deps.length})</label>
          <div className="badge-list" style={{ marginBottom: 14 }}>
            {deps.map((x, i) => (
              <span key={i} className="pill warn">{x.requiredType}: {x.requiredSchema}</span>
            ))}
          </div>
        </>
      )}

      <label>Deployment notes</label>
      <div className="notes">{d.notes || 'No notes recorded.'}</div>
      {d.notesFile && (
        <div className="right">
          <button className="btn small secondary" onClick={() => api.util.revealPath(d.notesFile)}>Open notes file</button>
          {d.notesOneDriveUrl && <button className="btn small secondary" onClick={() => api.util.openExternal(d.notesOneDriveUrl)}>Open notes in OneDrive</button>}
        </div>
      )}
      </div>
    </dialog>
  );
}
