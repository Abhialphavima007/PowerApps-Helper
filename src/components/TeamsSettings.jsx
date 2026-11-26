import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import TeamsNotificationFields, { TEAMS_DEFAULTS } from './TeamsNotificationFields.jsx';

// Opening Settings preserves the saved transport and legacy callback contract.
const notificationChoices = choices => ({ ...TEAMS_DEFAULTS, ...choices,
  workflowRouting: choices?.workflowRouting || (choices ? 'fixed' : 'payload') });

export default function TeamsSettings({ settings, onSaved }) {
  const [draft, setDraft] = useState(() => notificationChoices(settings.teamsNotifications));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [workflowUrl, setWorkflowUrl] = useState('');
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [revealedWorkflow, setRevealedWorkflow] = useState('');
  const revealTimer = useRef(null);
  const revealRequest = useRef(0);
  const edited = useRef(false);
  const workflowSaved = !!status?.workflow?.configured;
  const workflowLocked = workflowSaved && !editingWorkflow;
  const hideWorkflow = () => {
    revealRequest.current++;
    clearTimeout(revealTimer.current);
    setRevealedWorkflow('');
  };
  const workflowAction = async (name, ...args) => {
    // An older running main/preload must never fall back to direct Graph sign-in.
    if (typeof api.teams[name] !== 'function') throw new Error('Restart PowerApps Helper to load the workflow connection update. Your saved address will be kept.');
    try { return await api.teams[name](...args); }
    catch (error) {
      if (/No handler registered|not a function/i.test(error.message || '')) {
        throw new Error('Restart PowerApps Helper to load the workflow connection update. Your saved address will be kept.');
      }
      throw error;
    }
  };
  const refresh = async () => {
    const result = await api.teams.status();
    if (!result.ok) throw new Error(result.error);
    setStatus(result);
    return result;
  };
  useEffect(() => {
    let active = true;
    api.teams.status().then(result => {
      if (!active) return;
      setStatus(result);
      // New callback setup uses the Helper flow's dynamic people.
      // Saved legacy workflows retain their fixed-recipient contract.
      if (result.ok && !result.workflow?.configured && !edited.current) {
        setDraft(current => ({ ...current, workflowRouting: 'payload' }));
      }
    }).catch(() => {});
    const off = api.teams.onProgress(run => setStatus(current => ({ ...current,
      runs: [...(current?.runs || []).filter(item => item.runId !== run.runId), run] })));
    return () => { active = false; off(); revealRequest.current++; clearTimeout(revealTimer.current); };
  }, []);
  const action = async task => {
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (e) { setError(e.message || 'Teams settings could not be updated.'); }
    finally { setBusy(false); }
  };
  const changeDraft = next => {
    edited.current = true;
    if (next.transport !== draft.transport) {
      hideWorkflow(); setWorkflowUrl(''); setEditingWorkflow(false);
    }
    setDraft(notificationChoices(next)); setError(''); setMessage('');
  };
  const revealWorkflow = () => action(async () => {
    const request = ++revealRequest.current;
    const result = await workflowAction('revealWorkflow');
    if (request !== revealRequest.current) return;
    if (!result.ok) throw new Error(result.error || 'The saved workflow address could not be shown.');
    setRevealedWorkflow(result.value);
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(hideWorkflow, 30000);
  });
  const removeWorkflow = () => action(async () => {
    hideWorkflow();
    const result = await api.teams.removeWorkflow();
    if (!result.ok) throw new Error(result.error);
    setWorkflowUrl(''); setEditingWorkflow(false);
    setStatus(current => ({ ...current, workflow: result.workflow }));
    await refresh(); setMessage('Workflow address removed. Workflow notifications have stopped.');
  });
  const save = (connect = false) => action(async () => {
    hideWorkflow();
    if (draft.transport === 'workflow' && editingWorkflow && workflowSaved && !workflowUrl.trim()) {
      throw new Error('Paste the replacement workflow address, or choose Cancel to keep the saved address.');
    }
    let saved;
    let warning = '';
    if (draft.transport === 'workflow' && workflowUrl.trim()) {
      const result = await api.teams.saveWorkflow(workflowUrl, notificationChoices(draft));
      if (!result.ok) throw new Error(result.error || 'Workflow connection could not be saved.');
      saved = result.settings;
      warning = result.warning || '';
      setWorkflowUrl(''); setEditingWorkflow(false);
      setStatus(current => ({ ...current, workflow: result.workflow }));
    } else {
      saved = await api.settings.save({ teamsNotifications: notificationChoices(draft) });
    }
    onSaved(saved); setDraft(notificationChoices(saved.teamsNotifications));
    let confirmation = saved.teamsNotifications.enabled
      ? saved.teamsNotifications.transport === 'workflow'
        ? 'Settings saved. Requests use your saved workflow; check its run history for Teams delivery.'
        : 'Send-as-me settings saved. Use Save and sign in to send as me to authorize your Microsoft account.'
      : 'Teams settings saved. Notifications are off.';
    if (connect) {
      const workflowMode = saved.teamsNotifications.transport === 'workflow';
      const result = workflowMode ? await workflowAction('checkWorkflow')
        : await api.teams.connect('graph');
      if (!result.ok) throw new Error(`Teams settings saved. ${result.error || (workflowMode ? 'Workflow setup could not be checked.' : 'Teams sign-in could not complete.')}`);
      if (workflowMode && result.transport !== 'workflow') throw new Error('Restart PowerApps Helper to load the workflow connection update. Your saved address will be kept.');
      confirmation = result.transport === 'workflow' ? result.message
        : `Teams connected as ${result.user.displayName || result.user.username}. ${saved.teamsNotifications.enabled
          ? 'New deployments send updates from this account to your selected destinations.' : 'Notifications remain off until enabled.'}`;
    }
    if (warning) confirmation += ` ${warning}`;
    const current = await refresh();
    if (saved.teamsNotifications.enabled && saved.teamsNotifications.codexEnabled && !current.bridge?.enabled) {
      confirmation += ' Optional Codex access could not start. Check secure credential storage and save again.';
    }
    setMessage(confirmation);
  });
  return <section className="card teams-settings-card" aria-labelledby="teams-settings-title">
    <header className="settings-card-header">
      <div><h2 id="teams-settings-title">Teams notifications</h2>
        <p className="muted">Keep people, group chats and channels informed, from the first step to the final result.</p></div>
      <span className={`pill ${settings.teamsNotifications?.enabled ? 'ok' : 'muted'}`}>
        {settings.teamsNotifications?.enabled ? 'Notifications on' : 'Notifications off'}
      </span>
    </header>
    <div className="settings-info-strip">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h6v10H3Z M15 7h6v10h-6Z M9 12h6m-3-3 3 3-3 3" /></svg>
      <span>Every update includes the solution, source → destination, and current deployment stage.</span>
    </div>
    <div className="settings-group">
    <h3>Who sends the updates?</h3>
    <div className="settings-form-grid">
    <div>
    <label htmlFor="teams-connection">Send deployment updates as</label>
    <select id="teams-connection" value={draft.transport} disabled={busy} aria-describedby="teams-sender-hint"
      onChange={e => changeDraft({ ...draft, transport: e.target.value })}>
      <option value="workflow">Workflows bot (recommended)</option>
      <option value="graph">Send as me — my Teams account</option>
    </select>
    </div>
    {draft.transport === 'workflow' && <div>
      <label htmlFor="teams-routing">Workflow destinations</label>
      <select id="teams-routing" value={draft.workflowRouting} disabled={busy}
        onChange={e => changeDraft({ ...draft, workflowRouting: e.target.value })}>
        <option value="payload">Use destinations selected in Helper (Helper workflow)</option>
        <option value="fixed">Destinations fixed in an existing workflow</option>
      </select>
    </div>}
    </div>
    <div id="teams-sender-hint" className="settings-sender-summary">
      <b>{draft.transport === 'graph' ? 'From your own Teams account' : 'From the Workflows bot'}</b>
      <p>{draft.transport === 'graph'
        ? 'Updates are sent from the Microsoft account signed in to Helper, including for optional Codex updates. People receive private messages; group and channel updates go to the pasted destinations.'
        : 'The Helper workflow sends deployment cards as the Workflows bot to people, an existing group chat and a channel. Choose Send as me above to use your own Teams account instead.'}</p>
    </div>
    {draft.transport === 'workflow' ? <>
      <p className="muted">{draft.workflowRouting === 'payload'
        ? 'Use the updated PowerApps Helper deployment notification workflow. Destination changes apply to new deployments.'
        : 'Keep the workflow actions and selected destinations in sync, then save its address again when destinations change.'}</p>
      <label htmlFor="teams-workflow-url">Workflow webhook address</label>
      <div className="credential-controls">
      <input id="teams-workflow-url" type={workflowLocked && revealedWorkflow ? 'text' : 'password'}
        readOnly={workflowLocked} value={workflowLocked ? (revealedWorkflow || 'saved-workflow-address') : workflowUrl} maxLength={8000}
        autoComplete="off" spellCheck={false} disabled={busy} aria-describedby="teams-workflow-hint teams-workflow-status"
        placeholder="Paste the signed address from the Teams webhook trigger"
        onChange={e => { if (!workflowLocked) { edited.current = true; setWorkflowUrl(e.target.value); setError(''); setMessage(''); } }} />
      {workflowLocked ? <>
        <button className="btn small secondary" disabled={busy} aria-controls="teams-workflow-url"
          aria-label={revealedWorkflow ? 'Hide saved workflow address' : 'Show saved workflow address'}
          onClick={revealedWorkflow ? hideWorkflow : revealWorkflow}>{revealedWorkflow ? 'Hide' : 'Show'}</button>
        <button className="btn small secondary" disabled={busy} onClick={() => {
          hideWorkflow(); setWorkflowUrl(''); setEditingWorkflow(true); setError(''); setMessage('');
        }}>Replace</button>
        <button className="btn small secondary" disabled={busy} onClick={removeWorkflow}>Remove</button>
      </> : workflowSaved && <button className="btn small secondary" disabled={busy} onClick={() => {
        hideWorkflow(); setWorkflowUrl(''); setEditingWorkflow(false); setError(''); setMessage('');
      }}>Cancel</button>}
      </div>
      <p id="teams-workflow-hint" className="muted">{workflowLocked
        ? 'Saved securely on this computer. Show requires Windows Hello and hides the address after 30 seconds. Use Replace to change it.'
        : 'Keep this secret address private. It is stored encrypted on this computer. Save below to keep this address for future deployments.'}</p>
      <p id="teams-workflow-status" className="settings-connection-status" role="status">{!status?.workflow?.configured ? 'No workflow address saved.'
        : status.workflow.destinationsMatch ? 'Workflow address saved. Teams delivery unverified.'
          : 'Saved workflow routing needs attention. Match its destination mode and save the address again.'}</p>
      <details className="settings-details"><summary>How to connect your workflow</summary>
        <ol><li>In the Teams webhook trigger, set <b>Who can trigger the flow</b> to <b>Anyone</b>.</li>
          <li>Save it with a Teams connection and turn the flow on.</li>
          <li>Copy the newly generated webhook address here, then save and check the setup.</li></ol>
        <p className="muted">Uses your existing authorized Teams workflow connection. Save and check verifies the saved setup without opening Microsoft sign-in. Optional Codex updates use the same workflow. Your organisation can still restrict workflows or Teams access. Saving does not confirm delivery.</p>
      </details>
    </> : <>
      <p className="muted">Requires Microsoft permission to send Teams messages as you. Your organisation may require administrator approval. A workflow webhook is not needed for this option.</p>
      <details className="settings-details"><summary>How to set up Send as me</summary>
        <ol><li>Sign in to Helper with the Microsoft account you want to send from.</li>
          <li>Enter people, group chat or channel links and choose your update interval.</li>
          <li>Enable notifications, then select <b>Save and sign in to send as me</b>. Complete Microsoft sign-in with the same account.</li></ol>
        <p className="muted">If Microsoft asks for admin approval, your administrator must approve the connection before it can send. Recipients must be reachable in your Teams organisation; guest and external recipients are not verified. Helper sends in the background while open after authorization.</p>
      </details>
    </>}
    </div>
    <TeamsNotificationFields value={draft} onChange={changeDraft} disabled={busy} showCodex />
    <div className="toolbar settings-save-actions">
      <button className="btn" disabled={busy} onClick={() => save()}>Save Teams settings</button>
      <button className="btn secondary" disabled={busy || !(draft.recipients.trim() || draft.groupLink?.trim() || draft.channelLink?.trim())} onClick={() => save(true)}>
        {draft.transport === 'workflow' ? 'Save and check workflow setup' : 'Save and sign in to send as me'}
      </button>
    </div>
    {message && <div className="alert info" role="status">{message}</div>}
    {error && <div className="alert err" role="alert">{error}</div>}
    <details className="settings-details settings-connection-tools"><summary>Connection tools & Codex details</summary>
      <div className="toolbar">
      <button className="btn secondary" disabled={busy} onClick={() => action(refresh)}>Refresh delivery status</button>
      <button className="btn secondary" disabled={busy || !settings.teamsNotifications?.codexEnabled} aria-expanded={showConfig && !!status?.mcpConfiguration} aria-controls="teams-codex-config" onClick={() => setShowConfig(!showConfig)}>Codex connection details</button>
    </div>
    <div id="teams-codex-config" hidden={!showConfig || !status?.mcpConfiguration}>
    {status?.mcpConfiguration && <>
      <p role="status">Codex connection: {status.bridge?.enabled ? 'Ready on this computer' : 'Unavailable. Enable Teams and Codex, then save settings.'}</p>
      <p>Add an MCP connection using these executable and argument values. Keep PowerApps Helper open and signed in.</p>
      <pre className="log">{JSON.stringify(status.mcpConfiguration, null, 2)}</pre>
      <p className="muted">Codex supplies the deployment stage and outcome through MCP. Helper sends Teams updates to your saved destinations in the background at your saved interval. MCP does not bypass Microsoft permissions or monitor a deployment independently.</p>
    </>}
    </div>
    </details>
    {status?.runs?.length > 0 && <details className="settings-details"><summary>Recent Teams notification delivery</summary>
      <ul>{status.runs.slice(-10).reverse().map(run => <li key={run.runId}>
        {run.solution} · {run.sourceEnv || 'Package file'} → {run.targetEnv} · {run.origin}: {run.state} · {run.sent} message requests accepted{run.closed ? ' · Finished' : run.state === 'disabled' ? ' · Reporting off' : ' · In progress'}
        {run.transport === 'workflow' && <span> · Teams delivery unconfirmed; check workflow run history</span>}
        {run.error && <p className="muted">{run.error}</p>}
        <ul>{run.destinations.map(destination => <li key={destination.name}>{destination.name}: {destination.state}</li>)}</ul>
      </li>)}</ul>
    </details>}
    <p className="muted settings-footer-note">Delivery errors appear separately from deployment results. An accepted request does not confirm that someone read the message.</p>
  </section>;
}
