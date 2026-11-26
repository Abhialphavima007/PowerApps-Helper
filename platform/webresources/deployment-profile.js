/* PowerApps Helper profile form v1.1.3. Supported model-driven form APIs only. */
(function (root) {
  'use strict';
  var states = new WeakMap();
  var guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var lookupName = 'abhi_approvalflowuser';
  var idName = 'abhi_flowuserid';
  function state(form) {
    if (!states.has(form)) states.set(form, { revision: 0, pending: false, invalid: false });
    return states.get(form);
  }
  function notify(form, message, level) {
    form.ui.setFormNotification(message, level, 'helper-flow-account');
  }
  function id(value) { return String(value || '').replace(/[{}]/g, '').toLowerCase(); }
  function api() { return root.Xrm.WebApi; }
  async function onLoad(executionContext) {
    var form = executionContext.getFormContext();
    var savedId = id(form.getAttribute(idName).getValue());
    var lookup = form.getAttribute(lookupName);
    var current = state(form);
    if (!current.registered) {
      lookup.addOnChange(onAccountChange);
      form.data.entity.addOnSave(onSave);
      current.registered = true;
    }
    var revision = current.revision;
    notify(form, 'Select the Dataverse connection account used by the approval flow. Confirm that account in Power Automate Connections first; it may differ from the flow owner or your sign-in.', 'INFO');
    // Hydrate only the display. Existing trusted GUIDs are never replaced by
    // the current sign-in or by the flow owner, or changed during form load.
    if (!guid.test(savedId) || lookup.getValue()) return;
    try {
      var user = await api().retrieveRecord('systemuser', savedId, '?$select=systemuserid,fullname,isdisabled');
      if (current.revision !== revision || lookup.getValue() || id(form.getAttribute(idName).getValue()) !== savedId) return;
      if (user.isdisabled || id(user.systemuserid) !== savedId) throw new Error('Inactive account');
      lookup.setValue([{ id: user.systemuserid, name: user.fullname, entityType: 'systemuser' }]);
      // Persist the display lookup on the next save; the canonical trust field
      // remains unchanged until an explicit account selection is validated.
    } catch {
      if (current.revision === revision) notify(form, 'The saved trusted account could not be displayed. Check user-read permission and select the verified approval flow Dataverse connection account.', 'WARNING');
    }
  }
  async function onAccountChange(executionContext) {
    var form = executionContext.getFormContext();
    var current = state(form);
    var revision = ++current.revision;
    var selected = form.getAttribute(lookupName).getValue();
    var trusted = form.getAttribute(idName);
    current.invalid = true;
    current.pending = false;
    if (!selected || !selected.length) {
      trusted.setValue(null);
      notify(form, 'Select the verified approval flow Dataverse connection account before enabling approval.', 'WARNING');
      current.invalid = false;
      return;
    }
    var selectedId = id(selected[0].id);
    if (selected[0].entityType !== 'systemuser' || !guid.test(selectedId)) {
      notify(form, 'Choose a valid Dataverse user for the approval flow connection.', 'ERROR');
      return;
    }
    current.pending = true;
    try {
      var user = await api().retrieveRecord('systemuser', selectedId, '?$select=systemuserid,fullname,isdisabled');
      if (current.revision !== revision) return;
      if (user.isdisabled || id(user.systemuserid) !== selectedId) throw new Error('Inactive account');
      trusted.setValue(selectedId);
      trusted.setSubmitMode('always');
      current.invalid = false;
      notify(form, 'Trusted ID filled for ' + user.fullname + '. Verify this is the approval flow Dataverse connection account, then save the profile.', 'INFO');
    } catch {
      if (current.revision === revision) notify(form, 'This account could not be verified. Check that it is active and that you can read Dataverse users. The trusted ID was not changed.', 'ERROR');
    } finally {
      if (current.revision === revision) current.pending = false;
    }
  }
  function onSave(executionContext) {
    var form = executionContext.getFormContext();
    var current = state(form);
    var selected = form.getAttribute(lookupName).getValue();
    if (current.pending || current.invalid || (selected && id(selected[0].id) !== id(form.getAttribute(idName).getValue()))) {
      executionContext.getEventArgs().preventDefault();
      notify(form, 'Wait for the account check, or choose an active verified approval flow connection account before saving.', 'ERROR');
    }
  }
  root.ABHI = root.ABHI || {};
  root.ABHI.DeploymentProfile = { onLoad: onLoad, onAccountChange: onAccountChange, onSave: onSave };
  if (typeof module !== 'undefined') module.exports = root.ABHI.DeploymentProfile;
}(typeof window !== 'undefined' ? window : globalThis));
