import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function HistoryView() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = async () => setItems(await api.history.list());
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <p className="h1" style={{ margin: 0 }}>Deployment history</p>
          <p className="sub" style={{ margin: 0 }}>Every env-to-env deployment, with notes and dependencies.</p>
        </div>
        <button className="btn small secondary" onClick={load}>Refresh</button>
      </div>

      {items.length === 0 ? (
        <div className="card"><div className="empty">No deployments yet.</div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
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
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                  <td>{d.solution}</td>
                  <td><span className={'pill ' + (d.exportManaged ? 'managed' : 'unmanaged')}>{d.exportManaged ? 'Managed' : 'Unmanaged'}</span></td>
                  <td className="muted">{d.version}</td>
                  <td className="muted">{d.sourceEnv} → {d.targetEnv}</td>
                  <td>
                    <span className={'pill ' + (d.status === 'success' ? 'ok' : d.status === 'failed' ? 'bad' : 'muted')}>
                      {d.status}
                    </span>
                  </td>
                  <td><button className="btn small secondary" onClick={() => setSelected(d)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <Detail d={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Detail({ d, onClose }) {
  const deps = d.dependencies || [];
  return (
    <div className="card">
      <div className="toolbar">
        <h3 style={{ margin: 0, flex: 1 }}>{d.solution} · v{d.version}</h3>
        <button className="btn small secondary" onClick={onClose}>Close</button>
      </div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="k">When</div><div>{new Date(d.createdAt).toLocaleString()}</div>
        <div className="k">Route</div><div>{d.sourceEnv} → {d.targetEnv}</div>
        <div className="k">Type</div><div>{d.exportManaged ? 'Managed' : 'Unmanaged'}</div>
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

      {d.error && <div className="alert err">{d.error}</div>}

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
        </div>
      )}
    </div>
  );
}
