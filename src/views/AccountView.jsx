import React from 'react';
import { api } from '../api.js';

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function AccountView({ account, accounts, envs, envLoading, envError, refreshEnvs, addAccount, addDeviceAccount, setSignInMethod, cancelAccount, switchAccount, signOut, busyAuth, authError }) {
  const ordered = [...(accounts || [])].sort((left, right) => Number(right.active) - Number(left.active));
  const remove = (item) => {
    if (window.confirm(`Remove ${item.username} from this app? You can connect it again later.`)) signOut(item.homeAccountId);
  };

  return <div>
    <div className="account-page-head">
      <div><p className="h1">Accounts</p><p className="sub">Manage Microsoft work accounts and the environments available to the active account.</p></div>
      <div className="account-head-actions">
        <button className="btn" disabled={busyAuth} onClick={addAccount}>{busyAuth ? <span className="spin" /> : '+ Add account'}</button>
        <button className="btn secondary" disabled={busyAuth} onClick={addDeviceAccount}>Use device code</button>
        {busyAuth && <button className="btn secondary" onClick={cancelAccount}>Cancel sign-in</button>}
      </div>
    </div>
    {authError && <div className="alert err">{authError}</div>}

    <div className="account-overview">
      <div className="account-overview-icon">{initials(account?.name || account?.username)}</div>
      <div className="account-overview-text">
        <span className="eyebrow">ACTIVE ACCOUNT</span>
        <h2>{account?.name || 'No account connected'}</h2>
        <div className="muted">{account?.username || 'Add a Microsoft work account to get started.'}</div>
        {account?.tenantId && <div className="account-tenant">Tenant {account.tenantId}</div>}
        {account && <div className="account-sign-in-method">
          <label htmlFor="account-sign-in-method">Sign-in method</label>
          <select id="account-sign-in-method" value={account.signInMethod || 'browser'} disabled={busyAuth} onChange={(event) => setSignInMethod(event.target.value)}>
            <option value="browser">Browser</option>
            <option value="deviceCode">Device code</option>
          </select>
          <p className="muted">Used when Microsoft requests sign-in again, including OneDrive and deployment.</p>
        </div>}
      </div>
      <div className="account-overview-stats"><div><b>{accounts?.length || 0}</b><span>Accounts</span></div><div><b>{envs.length}</b><span>Environments</span></div></div>
    </div>

    <div className="section-head"><div><h3>Connected accounts</h3><p className="muted">Select an account to browse its environments and deploy with it.</p></div></div>
    {!ordered.length ? <div className="card empty">No accounts connected yet.</div> : <div className="account-grid">
      {ordered.map((item) => <div className={'account-card ' + (item.active ? 'active' : '')} key={item.homeAccountId}>
        <div className="account-card-top"><div className="account-avatar">{initials(item.name || item.username)}</div><span className={'pill ' + (item.active ? 'ok' : 'muted')}>{item.active ? 'Active' : 'Available'}</span></div>
        <h3>{item.name || item.username}</h3>
        <div className="muted account-mail">{item.username}</div>
        <div className="account-tenant">Tenant {item.tenantId || '—'}</div>
        <div className="account-card-actions">
          {!item.active && <button className="btn small" onClick={() => switchAccount(item.homeAccountId)}>Use account</button>}
          <button className="btn small secondary" onClick={() => remove(item)}>Remove</button>
        </div>
      </div>)}
    </div>}

    <div className="section-head"><div><h3>Environments {envLoading && <span className="spin" />}</h3><p className="muted">{account ? `Available to ${account.username}` : 'Connect an account to view environments.'}</p></div><button className="btn small secondary" onClick={refreshEnvs} disabled={!account || envLoading}>Refresh</button></div>
    {envError && <div className="alert warn">{envError}</div>}
    {!account ? <div className="card empty">Add an account to load environments.</div> : !envs.length ? <div className="card empty">{envLoading ? 'Loading environments…' : 'No environments found for this account.'}</div> : <div className="environment-grid">
      {envs.map((environment) => <div className="environment-card" key={environment.environmentUrl || environment.environmentId}>
        <div className="environment-card-top"><span className="environment-mark">◈</span><span className="pill muted">{environment.type || 'Environment'}</span></div>
        <h3>{environment.displayName}</h3>
        <div className="muted environment-url" title={environment.environmentUrl}>{environment.environmentUrl}</div>
        <button className="btn small secondary" onClick={() => api.util.openExternal(environment.environmentUrl)}>Open environment ↗</button>
      </div>)}
    </div>}
  </div>;
}
