import React from 'react';
import { api } from '../api.js';

export default function AccountView({ account, accounts, envs, envLoading, envError, refreshEnvs, providers, addAccount, switchAccount, signOut, busyAuth }) {
  return (
    <div>
      <p className="h1">Accounts &amp; environments</p>
      <p className="sub">
        Connect one or more Microsoft work accounts — no app registration needed. Switch the active
        account to see that account's environments. Tokens are cached locally and encrypted.
      </p>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0, flex: 1 }}>Connected accounts</h3>
          <button className="btn small" disabled={busyAuth} onClick={addAccount}>
            {busyAuth ? <span className="spin" /> : '+ Add account'}
          </button>
        </div>
        {(!accounts || accounts.length === 0) ? (
          <div className="empty">No accounts connected. Click “Add account”.</div>
        ) : (
          <table>
            <thead>
              <tr><th></th><th>Name</th><th>Account</th><th>Tenant</th><th></th></tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.homeAccountId}>
                  <td>{a.active ? <span className="pill ok">active</span> : ''}</td>
                  <td>{a.name}</td>
                  <td className="muted">{a.username}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{a.tenantId}</td>
                  <td>
                    {!a.active && <button className="btn small secondary" onClick={() => switchAccount(a.homeAccountId)}>Switch</button>}{' '}
                    <button className="btn small danger" onClick={() => signOut(a.homeAccountId)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0, flex: 1 }}>
            Environments {account ? `· ${account.name || account.username}` : ''} {envLoading && <span className="spin" />}
          </h3>
          <button className="btn small secondary" onClick={refreshEnvs} disabled={!account}>Refresh</button>
        </div>
        {envError && <div className="alert warn">{envError}</div>}
        {!account ? (
          <div className="empty">Add an account to load environments.</div>
        ) : envs.length === 0 ? (
          <div className="empty">{envLoading ? 'Loading…' : 'No environments found for this account.'}</div>
        ) : (
          <table>
            <thead><tr><th>Display name</th><th>Type</th><th>URL</th><th></th></tr></thead>
            <tbody>
              {envs.map((e) => (
                <tr key={e.environmentUrl}>
                  <td>{e.displayName}</td>
                  <td className="muted">{e.type || '—'}</td>
                  <td className="muted">{e.environmentUrl}</td>
                  <td><button className="btn small secondary" onClick={() => api.util.openExternal(e.environmentUrl)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>AI providers</h3>
        <div className="badge-list">
          <span className={'pill ' + (providers.gemini ? 'ok' : 'muted')}>Gemini {providers.gemini ? 'key set' : 'no key'}</span>
          <span className={'pill ' + (providers.grok ? 'ok' : 'muted')}>Grok {providers.grok ? 'key set' : 'no key'}</span>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Notes work without a key (template). Add <code>GEMINI_API_KEY</code> and/or <code>GROK_API_KEY</code> to <code>.env</code> for AI-polished notes.
        </p>
      </div>
    </div>
  );
}
