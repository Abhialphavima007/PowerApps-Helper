import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AuthView({ pac, envs, envLoading, envError, refreshEnvs, refreshPac, providers }) {
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [name, setName] = useState('');
  const [useDeviceCode, setUseDeviceCode] = useState(false);

  const loadProfiles = async () => {
    const r = await api.auth.list();
    setProfiles(r.profiles || []);
  };

  useEffect(() => {
    loadProfiles();
    const off = api.deploy.onProgress((d) => setLog((l) => l + d.text));
    return off;
  }, []);

  const login = async () => {
    setBusy(true);
    setLog('Opening sign-in… complete authentication in the browser window.\n');
    try {
      const r = await api.auth.create({ name: name || undefined, deviceCode: useDeviceCode });
      setLog((l) => l + (r.ok ? '\n✔ Signed in.\n' : '\n✖ ' + (r.stderr || r.stdout) + '\n'));
      await loadProfiles();
      await refreshEnvs();
    } finally {
      setBusy(false);
    }
  };

  const select = async (index) => {
    await api.auth.select(index);
    await loadProfiles();
    await refreshEnvs();
  };

  const remove = async (index) => {
    await api.auth.remove(index);
    await loadProfiles();
  };

  return (
    <div>
      <p className="h1">Sign-in &amp; Environments</p>
      <p className="sub">
        Authenticate with the Power Platform CLI — no app registration needed. Anyone with access to
        an environment can sign in and deploy.
      </p>

      {pac && !pac.installed && (
        <div className="alert err">
          {pac.message}
          <div className="right">
            <button className="btn small secondary" onClick={refreshPac}>
              Re-check
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Add an auth profile</h3>
        <div className="row">
          <div className="col">
            <label>Profile name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. dev-tenant" />
          </div>
          <div className="col" style={{ maxWidth: 220 }}>
            <label>Method</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text)' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={useDeviceCode}
                onChange={(e) => setUseDeviceCode(e.target.checked)}
              />
              Use device code
            </label>
          </div>
        </div>
        <div className="right">
          <button className="btn" disabled={busy || (pac && !pac.installed)} onClick={login}>
            {busy ? <span className="spin" /> : '🔑 Sign in'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0, flex: 1 }}>Auth profiles</h3>
          <button className="btn small secondary" onClick={loadProfiles}>
            Refresh
          </button>
        </div>
        {profiles.length === 0 ? (
          <div className="empty">No profiles yet. Sign in above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>User</th>
                <th>Kind</th>
                <th>Environment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.index}>
                  <td>{p.active ? <span className="pill ok">active</span> : ''}</td>
                  <td>{p.name}</td>
                  <td className="muted">{p.user}</td>
                  <td className="muted">{p.kind}</td>
                  <td className="muted">{p.environment}</td>
                  <td>
                    {!p.active && (
                      <button className="btn small secondary" onClick={() => select(p.index)}>
                        Use
                      </button>
                    )}{' '}
                    <button className="btn small danger" onClick={() => remove(p.index)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0, flex: 1 }}>Environments {envLoading && <span className="spin" />}</h3>
          <button className="btn small secondary" onClick={refreshEnvs}>
            Refresh
          </button>
        </div>
        {envError && <div className="alert warn">{envError}</div>}
        {envs.length === 0 ? (
          <div className="empty">No environments loaded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Display name</th>
                <th>Type</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {envs.map((e) => (
                <tr key={e.environmentUrl || e.environmentId}>
                  <td>{e.displayName}</td>
                  <td className="muted">{e.type || '—'}</td>
                  <td className="muted">{e.environmentUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>AI providers</h3>
        <div className="badge-list">
          <span className={'pill ' + (providers.gemini ? 'ok' : 'muted')}>
            Gemini {providers.gemini ? 'key set' : 'no key'}
          </span>
          <span className={'pill ' + (providers.grok ? 'ok' : 'muted')}>
            Grok {providers.grok ? 'key set' : 'no key'}
          </span>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Add <code>GEMINI_API_KEY</code> and/or <code>GROK_API_KEY</code> to the <code>.env</code>{' '}
          file, then restart the app.
        </p>
      </div>

      {log && (
        <div className="card">
          <h3>CLI output</h3>
          <div className="log">{log}</div>
        </div>
      )}
    </div>
  );
}
