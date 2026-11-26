import React from 'react';

export const TEAMS_DEFAULTS = { enabled: false, transport: 'workflow', workflowRouting: 'payload', recipients: '', groupLink: '', channelLink: '', intervalMinutes: 5,
  started: true, progress: true, success: true, failure: true, codexEnabled: false };

export default function TeamsNotificationFields({ value, onChange, disabled, prefix = 'teams', showCodex = false }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  const check = (key, label, hint, className = '') => <label className={`check ${className}`} key={key}>
    <input type="checkbox" checked={value[key]} onChange={e => change(key, e.target.checked)} />
    <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
  </label>;
  return <fieldset disabled={disabled} className="settings-fields">
    <legend className="settings-group-title">Notification preferences</legend>
    {check('enabled', showCodex ? 'Enable Teams deployment notifications' : 'Notify Teams for this deployment',
      'Send deployment updates to your selected destinations while Helper is open.', 'settings-toggle')}
    <div className="settings-group">
    <h3>People to notify</h3>
    <label htmlFor={`${prefix}-people`}>People to notify privately</label>
    <textarea id={`${prefix}-people`} rows={2} maxLength={6000} value={value.recipients}
      aria-describedby={`${prefix}-people-hint`}
      placeholder="person@company.com; colleague@company.com" onChange={e => change('recipients', e.target.value)} />
    <p id={`${prefix}-people-hint`} className="muted">Separate work sign-in addresses with semicolons or new lines. Up to 20 people. {value.transport === 'graph'
      ? 'Each person receives a private message from the Microsoft account signed in to Helper. Use people in your Teams organisation other than yourself.'
      : value.workflowRouting === 'payload'
        ? 'The Helper workflow sends each selected person a private message from the workflow bot.'
        : 'The existing workflow controls delivery. Its private-message recipients must match these people.'}</p>
    </div>
    <div className="settings-group">
    <h3>Group chat and channel</h3>
    <p className="muted">Optional. Notify an existing group, a channel, or both. Leave people blank to send only to these destinations.</p>
    <div className="settings-form-grid">
      <div><label htmlFor={`${prefix}-group`}>Existing group chat link</label>
        <input id={`${prefix}-group`} type="url" maxLength={4000} value={value.groupLink || ''}
          aria-describedby={`${prefix}-group-hint`} placeholder="Paste the link copied from your Teams group chat"
          spellCheck={false} onChange={e => change('groupLink', e.target.value)} />
        <p id={`${prefix}-group-hint`} className="muted">In Teams, copy the link to your existing group chat. The sending account must be a member.</p>
      </div>
      <div><label htmlFor={`${prefix}-channel`}>Teams channel link</label>
        <input id={`${prefix}-channel`} type="url" maxLength={4000} value={value.channelLink || ''}
          aria-describedby={`${prefix}-channel-hint`} placeholder="Paste the link from Copy link to channel"
          spellCheck={false} onChange={e => change('channelLink', e.target.value)} />
        <p id={`${prefix}-channel-hint`} className="muted">Use Copy link to channel. The sending account needs access to the team and channel. Workflow cards support standard channels; private channels are unsupported.</p>
      </div>
    </div>
    <p className="muted">{value.transport === 'workflow'
      ? value.workflowRouting === 'payload'
        ? 'Use the updated Helper workflow for group and channel delivery. Updates appear as the Workflows bot using the workflow owner’s Teams connection.'
        : 'For a fixed workflow, configure these destinations in its actions too, then save the matching webhook address again.'
      : 'Updates come from your signed-in Teams account after Microsoft permission is granted.'} Changes apply to new deployments.</p>
    </div>
    <div className="settings-group">
    <h3>When to send updates</h3>
    <div className="settings-interval-row">
    <div><label htmlFor={`${prefix}-interval`}>Progress notification gap (minutes)</label>
    <input id={`${prefix}-interval`} type="number" min="1" max="1440" step="1" value={value.intervalMinutes}
      aria-describedby={`${prefix}-interval-hint`} onChange={e => change('intervalMinutes', e.target.value)} /></div>
    <p id={`${prefix}-interval-hint`} className="muted">Choose 1–1,440 minutes between progress updates. Selected completion and failure updates are sent immediately.</p>
    </div>
    <div className="settings-event-grid">
      {check('started', 'Started', 'When deployment begins')}
      {check('progress', 'Periodic progress', 'At your chosen interval')}
      {check('success', 'Completed', 'When deployment succeeds')}
      {check('failure', 'Failure', 'When something fails')}
    </div>
    <p className="muted">Teams delivery can take longer. Progress follows your gap while the app is open.</p>
    </div>
    {showCodex && check('codexEnabled', 'Allow optional Codex deployment notifications on this computer',
      'Codex can report deployment updates through this same connection.', 'settings-toggle')}
  </fieldset>;
}
