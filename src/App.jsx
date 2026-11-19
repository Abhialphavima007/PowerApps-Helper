import React, { useEffect, useState, useCallback } from 'react';
import { api, hasApi } from './api.js';
import AccountView from './views/AccountView.jsx';
import DeployView from './views/DeployView.jsx';
import HistoryView from './views/HistoryView.jsx';
import SettingsView from './views/SettingsView.jsx';
import SignInPrompt from './components/SignInPrompt.jsx';

export default function App() {
  const [tab, setTab] = useState('deploy');
  const [account, setAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [authReady, setAuthReady] = useState(false);
  const [busyAuth, setBusyAuth] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authProgress, setAuthProgress] = useState(null);
  const [deploymentNotification, setDeploymentNotification] = useState(null);
  const [envs, setEnvs] = useState([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState('');
  const [providers, setProviders] = useState({ gemini: false, grok: false });
  const refreshProviders = useCallback(() => api.ai.providers().then(setProviders), []);

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
    refreshProviders();
    refreshStatus().then((s) => {
      if (s.signedIn) refreshEnvs();
    });
  }, [refreshStatus, refreshEnvs, refreshProviders]);

  useEffect(() => {
    if (!hasApi) return;
    return api.auth.onProgress((data) => {
      setAuthProgress((current) => data.stage === 'finished'
        ? (current?.requestId === data.requestId ? null : current)
        : data);
    });
  }, []);

  useEffect(() => {
    if (!hasApi) return;
    return api.notifications.onDeployment(setDeploymentNotification);
  }, []);

  useEffect(() => {
    if (!deploymentNotification) return undefined;
    const timeout = setTimeout(() => setDeploymentNotification(null), 10000);
    return () => clearTimeout(timeout);
  }, [deploymentNotification]);

  const addAccount = async () => {
    await connectAccount('browser');
  };
  const addDeviceAccount = async () => {
    await connectAccount('deviceCode');
  };
  const connectAccount = async (method) => {
    setBusyAuth(true);
    setAuthError('');
    try {
      const r = await api.auth.add({ method });
      if (r.ok) {
        await refreshStatus();
        await refreshEnvs();
      } else {
        setAuthError(/sign-in cancelled/i.test(r.error || '') ? '' : (r.error || 'Sign-in failed.'));
      }
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setBusyAuth(false);
    }
  };
  const cancelAccount = () => api.auth.cancel();
  const setSignInMethod = async (method) => {
    setAuthError('');
    try {
      const result = await api.auth.setMethod(method);
      if (result.ok) await refreshStatus();
      else setAuthError(result.error || 'Could not change sign-in method.');
    } catch (error) { setAuthError(String(error)); }
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
            {busyAuth && <button className="btn small secondary" style={{ width: '100%', marginTop: 6 }} onClick={cancelAccount}>Cancel sign-in</button>}
          </div>
        )}
      </aside>

      <main className="main">
        {!signedIn && authReady && tab !== 'account' && (
          <SignInGate onSignIn={addAccount} onDeviceSignIn={addDeviceAccount} onCancel={cancelAccount} signingIn={busyAuth} error={authError} />
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
            refreshEnvs={refreshEnvs}
            addAccount={addAccount} addDeviceAccount={addDeviceAccount} setSignInMethod={setSignInMethod} cancelAccount={cancelAccount} switchAccount={switchAccount} signOut={signOut} busyAuth={busyAuth} authError={authError}
          />
        )}
        {signedIn && tab === 'settings' && <SettingsView providers={providers} onCredentialsChanged={refreshProviders} />}
      </main>
      {deploymentNotification && <div
        className={`deployment-toast ${deploymentNotification.level || 'success'}`}
        role={deploymentNotification.level === 'error' ? 'alert' : 'status'}
        aria-live={deploymentNotification.level === 'error' ? 'assertive' : 'polite'}
      >
        <div className="deployment-toast-copy">
          <b>{deploymentNotification.title}</b>
          <span>{deploymentNotification.message}</span>
        </div>
        <button type="button" aria-label="Dismiss notification" onClick={() => setDeploymentNotification(null)}>×</button>
      </div>}
      {authProgress && <SignInPrompt key={authProgress.requestId} progress={authProgress} onCancel={cancelAccount} />}
    </div>
  );
}

function SignInGate({ onSignIn, onDeviceSignIn, onCancel, signingIn, error }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-logo">Power<span>Apps</span> Helper</div>
        <p className="muted">Sign in with your Microsoft work account to list your environments and deploy solutions. No app registration required.</p>
        {error && <div className="alert err" style={{ textAlign: 'left' }}>{error}</div>}
        <button className="btn" disabled={signingIn} onClick={onSignIn}>
          {signingIn ? <span className="spin" /> : '🔐 Sign in with Microsoft'}
        </button>
        <button className="btn secondary" disabled={signingIn} onClick={onDeviceSignIn}>Sign in with device code</button>
        {signingIn && <button className="btn secondary" onClick={onCancel}>Cancel sign-in</button>}
      </div>
    </div>
  );
}
