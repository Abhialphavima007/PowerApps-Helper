import React, { useState } from 'react';
import { api } from '../api.js';

export default function DeploymentAutomationSettings({ settings, onSaved }) {
  const [draft, setDraft] = useState({ enabled: false, environmentUrl: '', profileKey: 'default', reportingDestination: 'target', ...settings.deploymentAutomation, repairTransport: 'auto' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const change = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setStatus(null); setMessage(''); };
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api.settings.save({ deploymentAutomation: draft });
      onSaved(saved);
      setDraft(saved.deploymentAutomation);
      setStatus(null);
      setMessage('Deployment automation settings saved.');
    } catch (e) { setError(e.message || 'Could not save deployment automation settings.'); }
    finally { setBusy(false); }
  };
  const check = async (retry = false) => {
    setBusy(true); setError('');
    try {
      const result = await (retry ? api.notifications.retryPending() : api.notifications.setupStatus());
      if (!result.ok) throw new Error(result.error);
      setStatus(result);
    } catch (e) { setError(e.message || 'Could not connect to PowerApps Helper Setup.'); }
    finally { setBusy(false); }
  };
  return <section className="card" aria-labelledby="deployment-email-title">
    <h2 id="deployment-email-title">Deployment emails & approval</h2>
    <p className="muted">Choose recipients and approval policy in PowerApps Helper Setup. Environment reports are sent only after a successful import or failure. Teams can continue sending progress updates separately.</p>
    <fieldset disabled={busy} className="settings-fields">
      <legend className="settings-group-title">Reporting connection</legend>
      <label className="check settings-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />
        <span><b>Enable environment reports & dependency approval</b><small>Report import results and require approval before the agent adds dependencies.</small></span></label>
      <div className="settings-group">
      <h3>PowerApps Helper Setup</h3>
      <label htmlFor="deployment-reporting-destination">Environment for success and failure reports</label>
      <select id="deployment-reporting-destination" value={draft.reportingDestination} onChange={e => change('reportingDestination', e.target.value)}>
        <option value="target">Deployment target (automatic)</option>
        <option value="setup">Fixed setup environment</option>
      </select>
      <p className="muted">Automatic reporting uses the target selected for that deployment. PowerApps Helper Setup and the outcome flow must be installed and configured in that environment.</p>
      <label htmlFor="deployment-setup-url">{draft.reportingDestination === 'target' ? 'Approval setup environment (optional)' : 'PowerApps Helper Setup environment'}</label>
      <input id="deployment-setup-url" type="url" placeholder={draft.reportingDestination === 'target' ? 'Leave blank to use the deployment target' : 'https://your-environment.crm.dynamics.com'} value={draft.environmentUrl} onChange={e => change('environmentUrl', e.target.value)} />
      <p className="muted">A separate approval environment lets your team keep one approval profile while outcome reports follow each target. Enter the environment URL where your approval flow and profile are installed. Both standard and Dataverse API environment URLs are supported.</p>
      <div className="settings-profile-field">
      <label htmlFor="deployment-profile-key">Notification profile key</label>
      <input id="deployment-profile-key" maxLength={100} value={draft.profileKey} onChange={e => change('profileKey', e.target.value)} />
      </div>
      </div>
      <div className="settings-group">
        <h3>Teams dependency approval</h3>
        <p className="muted">Configure the approval flow to notify the profile’s selected approvers privately in Teams. Approvers are separate from progress notification recipients. Choose “First response” in that profile to let one member approve; a rejection stops the repair. Each request lists the exact dependencies, source, target and expiry.</p>
        <p className="muted">Teams reminders identify the approval request. Confirm approval through its Microsoft approval email or Power Automate Approvals. Chat replies do not authorize changes. The approval flow must be configured and turned on before use.</p>
        <p className="muted">Approved dependencies are added using your existing Microsoft sign-in to the source environment. No separate Helper MCP connection is needed. Your account still needs permission to customize the source solution.</p>
        <p className="muted">In Setup, select the Dataverse account used by the approval flow with the “Approval flow account” field. Helper fills its trusted ID for you.</p>
      </div>
      <div className="toolbar settings-save-actions">
        <button className="btn" type="button" onClick={save}>Save</button>
        <button className="btn secondary" type="button" onClick={() => check()}>Check saved setup</button>
        <button className="btn secondary" type="button" onClick={() => check(true)}>Retry pending reports</button>
        {status?.setupUrl && <button className="btn secondary" type="button" onClick={() => api.util.openExternal(status.setupUrl)}>Open PowerApps Helper Setup</button>}
      </div>
    </fieldset>
    {message && <p role="status">{message}</p>}
    {error && <div className="alert err" role="alert">{error}</div>}
    {status && <div role="status">
      <p>{!status.enabled ? 'Deployment reporting is disabled.' : status.deferred ? status.message : 'Approval setup environment connected.'} Pending local reports: {status.pending}.</p>
      {status.enabled && status.targetDefault && <p>Outcome reporting follows each deployment’s target.</p>}
      {status.enabled && !status.deferred && <p>{status.profileEnabled ? 'Notification profile is enabled.' : 'Enable the notification profile in Setup.'} {status.approvalReady ? 'Approvers and trusted flow user are configured.' : 'Approval is not ready. Enable the profile and configure approvers and the verified trusted approval flow user before repairing dependencies.'}</p>}
      {status.enabled && !status.deferred && <p className="muted">This checks table access and configuration in the saved setup environment. Power Automate connections and active flows must also be configured in each reporting target.</p>}
    </div>}
  </section>;
}
