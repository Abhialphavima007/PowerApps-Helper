import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import WorkItemDetails from '../components/WorkItemDetails.jsx';

const AI_PROVIDERS = [
  { id: 'foundry', label: 'Azure AI Foundry', hint: 'Azure AI Foundry model API key' },
  { id: 'openai', label: 'OpenAI / Codex', hint: 'OpenAI API key' },
  { id: 'claude', label: 'Claude', hint: 'Anthropic API key' },
  { id: 'grok', label: 'Grok', hint: 'xAI API key' },
  { id: 'gemini', label: 'Gemini', hint: 'Google API key' }
];

function CredentialControl({ name, label, hint, saved, draft, editing, revealed, busy, revealBusy, onChange, onSave, onRemove, onReveal, onHide, onReplace, onCancel }) {
  const locked = saved && !editing;
  return <div className="credential-controls">
    <input
      type={locked && revealed ? 'text' : 'password'}
      aria-label={`${label} credential`}
      autoComplete="off"
      readOnly={locked}
      value={locked ? (revealed || 'saved-credential') : draft}
      onChange={(event) => { if (!locked) onChange(event.target.value); }}
      placeholder={hint}
    />
    {locked ? <>
      <button className="btn small secondary" disabled={!!busy || !!revealBusy} onClick={revealed ? onHide : onReveal}>{revealBusy ? <span className="spin" /> : revealed ? 'Hide' : 'Show'}</button>
      <button className="btn small secondary" disabled={!!busy} onClick={onReplace}>Replace</button>
      <button className="btn small secondary" disabled={!!busy} onClick={onRemove}>Remove</button>
    </> : <>
      <button className="btn small" disabled={!draft || !!busy} onClick={onSave}>Save</button>
      {saved && <button className="btn small secondary" disabled={!!busy} onClick={onCancel}>Cancel</button>}
    </>}
  </div>;
}

export default function SettingsView({ providers, onCredentialsChanged, theme, themeSaving, onThemeChange }) {
  const [settings, setSettings] = useState(null);
  const [clientPreference, setClientPreference] = useState(null);
  const [clientDraft, setClientDraft] = useState('');
  const [clientLoading, setClientLoading] = useState(true);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState('');
  const [clientReload, setClientReload] = useState(0);
  const clientRequest = useRef(0);
  const clientSavePending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [odBusy, setOdBusy] = useState(false);
  const [od, setOd] = useState(null);
  const [odError, setOdError] = useState('');
  const [credentialStatus, setCredentialStatus] = useState({});
  const [draftKeys, setDraftKeys] = useState({});
  const [credentialBusy, setCredentialBusy] = useState('');
  const [credentialMessage, setCredentialMessage] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [editingKeys, setEditingKeys] = useState({});
  const [revealedKeys, setRevealedKeys] = useState({});
  const [revealBusy, setRevealBusy] = useState('');
  const revealTimers = useRef({});
  const [previewReference, setPreviewReference] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(null);
  const [previewDetails, setPreviewDetails] = useState(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    api.settings.get().then(setSettings);
    api.credentials.status().then(setCredentialStatus).catch((e) => setCredentialError(String(e)));
    return () => Object.values(revealTimers.current).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const request = ++clientRequest.current;
    setClientLoading(true); setClientError('');
    Promise.resolve().then(() => api.settings.getClientName()).then((result) => {
      if (clientRequest.current !== request) return;
      if (!result.ok) throw new Error(result.error || 'Could not load the tenant client name.');
      setClientPreference(result); setClientDraft(result.clientName);
    }).catch((error) => {
      if (clientRequest.current === request) setClientError(error.message || 'Could not load the tenant client name.');
    }).finally(() => {
      if (clientRequest.current === request) setClientLoading(false);
    });
    return () => { clientRequest.current++; };
  }, [clientReload]);

  const saveClientName = async () => {
    if (!clientPreference || clientLoading || clientSavePending.current) return;
    const value = clientDraft.trim();
    if (value === clientPreference.clientName) { setClientDraft(value); return; }
    const request = clientRequest.current;
    clientSavePending.current = true;
    setClientSaving(true); setClientError('');
    try {
      const result = await api.settings.saveClientName(value, {
        tenantId: clientPreference.tenantId, homeAccountId: clientPreference.homeAccountId
      });
      if (clientRequest.current !== request) return;
      if (!result.ok) throw new Error(result.error || 'Could not save the client name.');
      setClientPreference(result); setClientDraft(result.clientName);
    } catch (error) {
      if (clientRequest.current === request) setClientError(error.message || 'Could not save the client name.');
    } finally {
      clientSavePending.current = false;
      if (clientRequest.current === request) setClientSaving(false);
    }
  };

  const hideCredential = (name) => {
    clearTimeout(revealTimers.current[name]);
    setRevealedKeys((current) => { const next = { ...current }; delete next[name]; return next; });
  };
  const revealCredential = async (name) => {
    setRevealBusy(name); setCredentialError('');
    try {
      const result = await api.credentials.reveal(name);
      if (!result.ok) throw new Error(result.error);
      setRevealedKeys((current) => ({ ...current, [name]: result.value }));
      clearTimeout(revealTimers.current[name]);
      revealTimers.current[name] = setTimeout(() => hideCredential(name), 30000);
    } catch (error) { setCredentialError(String(error.message || error)); }
    finally { setRevealBusy(''); }
  };

  const saveCredential = async (name) => {
    setCredentialBusy(name); setCredentialError(''); setCredentialMessage('');
    try {
      const result = await api.credentials.save(name, draftKeys[name] || '');
      if (!result.ok) throw new Error(result.error);
      setCredentialStatus(result.status);
      setDraftKeys((current) => ({ ...current, [name]: '' }));
      setEditingKeys((current) => ({ ...current, [name]: false }));
      hideCredential(name);
      setCredentialMessage(`${name === 'azureDevOps' ? 'Azure DevOps' : name} credential saved.`);
      await onCredentialsChanged();
    } catch (e) { setCredentialError(String(e.message || e)); }
    finally { setCredentialBusy(''); }
  };

  const removeCredential = async (name) => {
    setCredentialBusy(name); setCredentialError(''); setCredentialMessage('');
    try {
      const result = await api.credentials.remove(name);
      if (!result.ok) throw new Error(result.error);
      setCredentialStatus(result.status);
      setEditingKeys((current) => ({ ...current, [name]: false }));
      hideCredential(name);
      setCredentialMessage(`${name === 'azureDevOps' ? 'Azure DevOps' : name} credential removed.`);
      await onCredentialsChanged();
    } catch (e) { setCredentialError(String(e.message || e)); }
    finally { setCredentialBusy(''); }
  };

  const update = async (patch) => {
    setSaving(true);
    try {
      const next = await api.settings.save(patch);
      setSettings((current) => ({ ...current, ...next, aiModels: { ...next.aiModels, ...current.aiModels, ...patch.aiModels } }));
      if ('azureFoundryEndpoint' in patch || 'foundry' in (patch.aiModels || {})) await onCredentialsChanged();
    } finally {
      setSaving(false);
    }
  };

  const chooseFolder = async () => {
    const r = await api.settings.chooseFolder();
    if (r.ok) update({ localFolder: r.folder });
  };

  const connectOneDrive = async () => {
    setOdBusy(true);
    setOdError('');
    try {
      const r = await api.oneDrive.connect();
      if (r.ok) setOd(r);
      else setOdError(r.error || 'Could not connect OneDrive.');
    } finally {
      setOdBusy(false);
    }
  };

  const previewWorkItem = async () => {
    setPreviewBusy(true); setPreviewError(''); setPreviewDetails(null); setPreviewProgress(null);
    try {
      await api.settings.save({ azureDevOpsOrgUrl: settings.azureDevOpsOrgUrl });
      const result = await api.devops.fetch(previewReference, setPreviewProgress);
      if (!result.ok) throw new Error(result.error);
      setPreviewDetails(result);
    } catch (error) { setPreviewError(String(error.message || error)); }
    finally { setPreviewBusy(false); }
  };

  if (!settings) return <div className="empty">Loading…</div>;

  return (
    <div>
      <p className="h1">Settings</p>
      <p className="sub">Choose where exported solutions are stored. New exports use <code>Base folder / Client / Source to Target / Solution / export files</code>.</p>

      <div className="card">
        <fieldset className="appearance-options" disabled={themeSaving}>
          <legend>Appearance</legend>
          <p className="muted">Choose light or dark mode. Your choice is saved on this computer.</p>
          <div className="radio-row">
            {['light', 'dark'].map((mode) => <label key={mode} className={'radio ' + (theme === mode ? 'sel' : '')}>
              <input type="radio" name="appearance" value={mode} checked={theme === mode} onChange={() => onThemeChange(mode)} />
              <span><b>{mode === 'light' ? 'Light mode' : 'Dark mode'}</b><span className="muted">{mode === 'light' ? 'Bright surfaces and dark text.' : 'Dark surfaces and light text.'}</span></span>
            </label>)}
          </div>
        </fieldset>
      </div>

      <div className="card">
        <h3>Solution storage</h3>
        <div className="storage-client">
          <label htmlFor="storage-client">Client name</label>
          <input id="storage-client" value={clientDraft} maxLength={80} disabled={clientLoading || clientSaving || !clientPreference}
            onChange={(event) => setClientDraft(event.target.value)} onBlur={saveClientName}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
            aria-describedby="storage-client-hint" aria-invalid={!!clientError} placeholder={clientLoading ? 'Loading tenant name…' : 'Client name'} />
          <p id="storage-client-hint" className="muted">Filled from your signed-in tenant. Edit it for future exports; clear it to restore the automatic name. Edits are remembered per tenant.</p>
          {clientPreference?.source === 'domain' && <p className="muted">Tenant display name is unavailable; using your organization domain.</p>}
          {clientPreference?.source === 'tenant-id' && <p className="muted">Tenant display name is unavailable; using the tenant ID. You can enter a client name.</p>}
          {clientSaving && <p className="muted" role="status">Saving client name…</p>}
          {clientError && <div className="alert err" role="alert">{clientError} <button type="button" className="btn small secondary" onClick={() => clientPreference ? saveClientName() : setClientReload((value) => value + 1)}>Retry</button></div>}
        </div>
        <div className="radio-row">
          <label className={'radio ' + (settings.storageMode === 'local' ? 'sel' : '')} onClick={() => update({ storageMode: 'local' })}>
            <input type="radio" readOnly checked={settings.storageMode === 'local'} />
            <div>
              <b>Local folder</b>
              <div className="muted">Store on this computer in a structured folder.</div>
            </div>
          </label>
          <label className={'radio ' + (settings.storageMode === 'onedrive' ? 'sel' : '')} onClick={() => update({ storageMode: 'onedrive' })}>
            <input type="radio" readOnly checked={settings.storageMode === 'onedrive'} />
            <div>
              <b>OneDrive (recommended)</b>
              <div className="muted">Upload to your OneDrive for Business — same Microsoft account.</div>
            </div>
          </label>
        </div>

        {settings.storageMode === 'local' && (
          <div style={{ marginTop: 16 }}>
            <label>Local base folder</label>
            <div className="row" style={{ alignItems: 'center' }}>
              <input readOnly value={settings.localFolder} />
              <button className="btn secondary" style={{ maxWidth: 140 }} onClick={chooseFolder}>Choose…</button>
            </div>
          </div>
        )}

        {settings.storageMode === 'onedrive' && (
          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <div className="col">
                <label>OneDrive root folder</label>
                <input value={settings.oneDriveRoot} onChange={(e) => setSettings({ ...settings, oneDriveRoot: e.target.value })} onBlur={(e) => update({ oneDriveRoot: e.target.value })} />
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="btn secondary" disabled={odBusy} onClick={connectOneDrive}>
                  {odBusy ? <span className="spin" /> : 'Connect OneDrive'}
                </button>
              </div>
            </div>
            {odError && <div className="alert warn" style={{ marginTop: 12 }}>{odError}</div>}
            {od && (
              <div className="alert info" style={{ marginTop: 12 }}>
                Connected as <b>{od.user?.displayName}</b> ({od.user?.upn}) · drive: {od.drive?.driveType || 'business'}
              </div>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>Tip: connect the OneDrive of the account you use for deployments; uploads use the currently active account.</p>
          </div>
        )}
        {saving && <div className="muted" style={{ marginTop: 10 }}><span className="spin" /> Saving…</div>}
      </div>

      <div className="card">
        <h3>AI providers</h3>
        <p className="muted">Saved keys remain visible as masked fields. Showing a saved key requires Windows Hello and automatically hides it after 30 seconds. Work item details are sent to the chosen provider only when you request AI output. OpenAI requires an API key; a ChatGPT or Codex sign-in alone is not an API key.</p>
        {AI_PROVIDERS.map((item) => <div className="credential-row" key={item.id}>
          <div className="credential-heading"><b>{item.label}</b><span className={'pill ' + (providers[item.id] ? 'ok' : 'muted')}>{credentialStatus[item.id] && item.id === 'foundry' && !providers.foundry ? 'Key saved · complete setup' : credentialStatus[item.id] ? 'Saved' : providers[item.id] ? 'From .env' : 'Not configured'}</span></div>
          <CredentialControl name={item.id} label={item.label} hint={item.hint} saved={!!credentialStatus[item.id]} draft={draftKeys[item.id] || ''} editing={!!editingKeys[item.id]} revealed={revealedKeys[item.id]} busy={credentialBusy} revealBusy={revealBusy === item.id} onChange={(value) => setDraftKeys((current) => ({ ...current, [item.id]: value }))} onSave={() => saveCredential(item.id)} onRemove={() => removeCredential(item.id)} onReveal={() => revealCredential(item.id)} onHide={() => hideCredential(item.id)} onReplace={() => { hideCredential(item.id); setEditingKeys((current) => ({ ...current, [item.id]: true })); }} onCancel={() => { setDraftKeys((current) => ({ ...current, [item.id]: '' })); setEditingKeys((current) => ({ ...current, [item.id]: false })); }} />
          {item.id === 'foundry' && <><label style={{ marginTop: 8 }}>Model inference endpoint</label><input value={settings.azureFoundryEndpoint || ''} onChange={(event) => setSettings((current) => ({ ...current, azureFoundryEndpoint: event.target.value }))} onBlur={(event) => update({ azureFoundryEndpoint: event.target.value })} placeholder="https://your-resource.services.ai.azure.com/models" /><p className="muted">Use an Azure AI Foundry model endpoint or Azure OpenAI resource URL.</p></>}
          <label style={{ marginTop: 8 }}>{item.id === 'foundry' ? 'Model or deployment name' : 'Model'}</label>
          <input value={settings.aiModels?.[item.id] || ''} onChange={(event) => setSettings((current) => ({ ...current, aiModels: { ...current.aiModels, [item.id]: event.target.value } }))} onBlur={(event) => update({ aiModels: { [item.id]: event.target.value } })} />
        </div>)}
      </div>

      <div className="card">
        <h3>Azure DevOps</h3>
        <p className="muted">Connect an organization to load user stories, child work items, descriptions, and comments during deployment.</p>
        <label>Organization URL</label>
        <input value={settings.azureDevOpsOrgUrl || ''} onChange={(event) => setSettings((current) => ({ ...current, azureDevOpsOrgUrl: event.target.value }))} onBlur={(event) => update({ azureDevOpsOrgUrl: event.target.value })} placeholder="https://dev.azure.com/your-organization" />
        <label style={{ marginTop: 14 }}>Personal access token (Work Items: Read)</label>
        <CredentialControl name="azureDevOps" label="Azure DevOps" hint="Paste access token" saved={!!credentialStatus.azureDevOps} draft={draftKeys.azureDevOps || ''} editing={!!editingKeys.azureDevOps} revealed={revealedKeys.azureDevOps} busy={credentialBusy} revealBusy={revealBusy === 'azureDevOps'} onChange={(value) => setDraftKeys((current) => ({ ...current, azureDevOps: value }))} onSave={() => saveCredential('azureDevOps')} onRemove={() => removeCredential('azureDevOps')} onReveal={() => revealCredential('azureDevOps')} onHide={() => hideCredential('azureDevOps')} onReplace={() => { hideCredential('azureDevOps'); setEditingKeys((current) => ({ ...current, azureDevOps: true })); }} onCancel={() => { setDraftKeys((current) => ({ ...current, azureDevOps: '' })); setEditingKeys((current) => ({ ...current, azureDevOps: false })); }} />
        <p className="muted" style={{ marginBottom: 0 }}>The token stays on this computer in encrypted storage. It is sent only to the configured Azure DevOps organization.</p>
        <div style={{ marginTop: 18 }}>
          <label>Preview user stories or work items (separate IDs with commas)</label>
          <div className="credential-controls">
            <input value={previewReference} onChange={(event) => setPreviewReference(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && previewReference.trim()) previewWorkItem(); }} placeholder="AB#1234, 5678, 9012" />
            <button className="btn small secondary" disabled={!previewReference.trim() || previewBusy} onClick={previewWorkItem}>{previewBusy ? <span className="spin" /> : 'Fetch details'}</button>
          </div>
          {previewBusy && previewProgress && <div className="muted" style={{ marginTop: 8 }}>Loaded {previewProgress.loaded} items · {previewProgress.queued} queued across {previewProgress.roots} stories…</div>}
          {previewError && <div className="alert warn" style={{ marginTop: 10 }}>{previewError}</div>}
          {previewDetails && <WorkItemDetails details={previewDetails} />}
        </div>
      </div>
      {credentialError && <div className="alert err">{credentialError}</div>}
      {credentialMessage && <div className="alert info">{credentialMessage}</div>}
    </div>
  );
}
