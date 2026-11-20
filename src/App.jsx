import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { api, hasApi } from './api.js';
import AccountView from './views/AccountView.jsx';
import DeployView from './views/DeployView.jsx';
import HistoryView from './views/HistoryView.jsx';
import SettingsView from './views/SettingsView.jsx';
import SignInPrompt from './components/SignInPrompt.jsx';
import { applyTheme, normalizeTheme } from './theme.mjs';

export default function App({ initialTheme = 'dark' }) {
  const [theme, setTheme] = useState(() => normalizeTheme(initialTheme));
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState('');
  const themeSavePending = useRef(false);
  useLayoutEffect(() => applyTheme(theme), [theme]);

  const changeTheme = async (nextTheme) => {
    if (themeSavePending.current || nextTheme === theme) return;
    if (!['light', 'dark'].includes(nextTheme)) return;
    const previousTheme = theme;
    themeSavePending.current = true;
    setThemeSaving(true);
    setThemeError('');
    setTheme(nextTheme);
    try {
      const saved = await api.settings.save({ theme: nextTheme });
      if (saved?.theme !== nextTheme) throw new Error('Theme preference was not saved.');
    } catch {
      setTheme(previousTheme);
      setThemeError('Could not save the appearance setting. Please try again.');
    } finally {
      themeSavePending.current = false;
      setThemeSaving(false);
    }
  };
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
        <div className="brand"><span className="sidebar-icon brand-icon" aria-hidden="true">P</span><span className="sidebar-label">Power<span>Apps</span> Helper</span></div>
        <nav className="nav" aria-label="Main navigation">
          {[
            ['deploy', '🚀', 'Deploy'], ['history', '🕓', 'History'],
            ['account', '👤', 'Accounts'], ['settings', '⚙️', 'Settings']
          ].map(([id, icon, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-label={label} aria-current={tab === id ? 'page' : undefined} title={label} onClick={() => setTab(id)}><span className="sidebar-icon" aria-hidden="true">{icon}</span><span className="sidebar-label">{label}</span></button>)}
        </nav>
        <div className="spacer" />
        <div className="sidebar-appearance">
          <button type="button" className="sidebar-auth-button" disabled={themeSaving}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}>
            <span className="sidebar-icon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            <span className="sidebar-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
        {signedIn ? (
          <div className="acct-box" title={account.username}>
            <div className="sidebar-icon"><div className="acct-dot ok" /></div>
            <div className="acct-meta sidebar-label">
              <div className="acct-name">{account.name || account.username}</div>
              <div className="acct-mail">{account.username}</div>
            </div>
          </div>
        ) : (
          <div className="sidebar-auth">
            <button className="sidebar-auth-button" aria-label={busyAuth ? 'Signing in' : 'Sign in'} title={busyAuth ? 'Signing in' : 'Sign in'} disabled={busyAuth} onClick={addAccount}>
              <span className="sidebar-icon" aria-hidden="true">{busyAuth ? <span className="spin" /> : '🔐'}</span><span className="sidebar-label">{busyAuth ? 'Signing in…' : 'Sign in'}</span>
            </button>
            {busyAuth && <button className="sidebar-auth-button" aria-label="Cancel sign-in" title="Cancel sign-in" onClick={cancelAccount}><span className="sidebar-icon" aria-hidden="true">×</span><span className="sidebar-label">Cancel sign-in</span></button>}
          </div>
        )}
      </aside>

      <main className="main">
        {themeError && <div className="alert err" role="alert">{themeError}</div>}
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
        {signedIn && tab === 'settings' && <SettingsView key={`${account.homeAccountId}:${account.tenantId}`} providers={providers} onCredentialsChanged={refreshProviders} theme={theme} themeSaving={themeSaving} onThemeChange={changeTheme} />}
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
