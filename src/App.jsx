import React, { useEffect, useState, useCallback } from 'react';
import { api, hasApi } from './api.js';
import AccountView from './views/AccountView.jsx';
import DeployView from './views/DeployView.jsx';
import HistoryView from './views/HistoryView.jsx';
import SettingsView from './views/SettingsView.jsx';

export default function App() {
  const [tab, setTab] = useState('deploy');
  const [account, setAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [authReady, setAuthReady] = useState(false);
  const [busyAuth, setBusyAuth] = useState(false);
  const [envs, setEnvs] = useState([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState('');
  const [providers, setProviders] = useState({ gemini: false, grok: false });

  const refreshEnvs = useCallback(async () => {
    if (!hasApi) return;
    setEnvLoading(true);
    setEnvError('');
    setEnvs([]);
    try {
      const r = await api.env.list();
      if (r.ok) setEnvs(r.environments || []);
      else setEnvError(r.error || 'Could not list environments.');
    } catch (e) {
      setEnvError(String(e));
    } finally {
      setEnvLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const s = await api.auth.status();
    setAccount(s.account);
    setAccounts(s.accounts || []);
    setAuthReady(true);
    return s;
  }, []);

  useEffect(() => {
    if (!hasApi) return;
    api.ai.providers().then(setProviders);
    refreshStatus().then((s) => {
      if (s.signedIn) refreshEnvs();
    });
  }, [refreshStatus, refreshEnvs]);

  const addAccount = async () => {
    setBusyAuth(true);
    setEnvError('');
    try {
      const r = await api.auth.add();
      if (r.ok) {
        await refreshStatus();
        await refreshEnvs();
      } else {
        setEnvError(r.error || 'Sign-in failed.');
      }
    } finally {
      setBusyAuth(false);
    }
  };

  const switchAccount = async (id) => {
    await api.auth.setActive(id);
    await refreshStatus();
    await refreshEnvs();
  };

  const signOut = async (id) => {
    await api.auth.signOut(id);
    const s = await refreshStatus();
    if (s.signedIn) await refreshEnvs();
    else setEnvs([]);
  };

  if (!hasApi) {
    return (
      <div className="main">
        <p className="h1">PowerApps Helper</p>
        <div className="alert warn">
          This UI must run inside the Electron shell. Use <code>npm run dev</code> (or the packaged app).
        </div>
      </div>
    );
  }

  const signedIn = !!account;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Power<span>Apps</span> Helper</div>
        <nav className="nav">
          <button className={tab === 'deploy' ? 'active' : ''} onClick={() => setTab('deploy')}>🚀 Deploy</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>🕓 History</button>
          <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>👤 Accounts</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>⚙️ Settings</button>
        </nav>
        <div className="spacer" />
        {signedIn ? (
          <div className="acct-box" title={account.username}>
            <div className="acct-dot ok" />
            <div className="acct-meta">
              <div className="acct-name">{account.name || account.username}</div>
              <div className="acct-mail">{account.username}</div>
            </div>
          </div>
        ) : (
          <div className="acct-box">
            <button className="btn small" style={{ width: '100%' }} disabled={busyAuth} onClick={addAccount}>
              {busyAuth ? <span className="spin" /> : 'Sign in'}
            </button>
          </div>
        )}
      </aside>

      <main className="main">
        {!signedIn && authReady && tab !== 'account' && (
          <SignInGate onSignIn={addAccount} signingIn={busyAuth} error={envError} />
        )}

        {/* Deploy stays mounted so an in-progress export/analysis survives tab switches */}
        {signedIn && (
          <div style={{ display: tab === 'deploy' ? 'block' : 'none' }}>
            <DeployView account={account} envs={envs} envLoading={envLoading} envError={envError} refreshEnvs={refreshEnvs} providers={providers} />
          </div>
        )}

        {signedIn && tab === 'history' && <HistoryView />}
        {tab === 'account' && (
          <AccountView
            account={account} accounts={accounts} envs={envs} envLoading={envLoading} envError={envError}
            refreshEnvs={refreshEnvs} providers={providers}
            addAccount={addAccount} switchAccount={switchAccount} signOut={signOut} busyAuth={busyAuth}
          />
        )}
        {signedIn && tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function SignInGate({ onSignIn, signingIn, error }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-logo">Power<span>Apps</span> Helper</div>
        <p className="muted">Sign in with your Microsoft work account to list your environments and deploy solutions. No app registration required.</p>
        {error && <div className="alert err" style={{ textAlign: 'left' }}>{error}</div>}
        <button className="btn" disabled={signingIn} onClick={onSignIn}>
          {signingIn ? <span className="spin" /> : '🔐 Sign in with Microsoft'}
        </button>
      </div>
    </div>
  );
}
