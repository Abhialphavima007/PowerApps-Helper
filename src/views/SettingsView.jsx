import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [odBusy, setOdBusy] = useState(false);
  const [od, setOd] = useState(null);
  const [odError, setOdError] = useState('');

  useEffect(() => { api.settings.get().then(setSettings); }, []);

  const update = async (patch) => {
    setSaving(true);
    try {
      const next = await api.settings.save(patch);
      setSettings(next);
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

  if (!settings) return <div className="empty">Loading…</div>;

  return (
    <div>
      <p className="h1">Settings</p>
      <p className="sub">Choose where exported solutions are stored. Files are organized as <code>Account / Source → Target / Solution / version.zip</code>.</p>

      <div className="card">
        <h3>Solution storage</h3>
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
    </div>
  );
}
