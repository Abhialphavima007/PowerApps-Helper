'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeploymentNotifier } = require('../electron/services/deploymentNotifications');

test('publishes an in-app error alert when native notifications are unavailable', () => {
  const sent = [];
  const notify = createDeploymentNotifier({
    Notification: { isSupported: () => false },
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } })
  });

  const payload = notify('Deployment stopped', 'The target import failed.');

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'deployment:notification');
  assert.equal(sent[0][1], payload);
  assert.equal(payload.level, 'error');
  assert.equal(payload.message, 'The target import failed.');
});

test('shows native notifications and restores the app when clicked', () => {
  const sent = [];
  const activeNotifications = new Set();
  const windowCalls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    webContents: { send: (...args) => sent.push(args) },
    restore: () => windowCalls.push('restore'),
    show: () => windowCalls.push('show'),
    focus: () => windowCalls.push('focus')
  };
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; this.handlers = {}; }
    on(name, handler) { this.handlers[name] = handler; }
    show() { this.shown = true; }
  }

  const notify = createDeploymentNotifier({ Notification: FakeNotification, getWindow: () => window, activeNotifications });
  notify('Deployment complete', 'The solution was imported successfully.');

  const [notification] = activeNotifications;
  assert.equal(sent.length, 1);
  assert.equal(notification.options.silent, false);
  assert.equal(notification.shown, true);
  notification.handlers.click();
  assert.deepEqual(windowCalls, ['restore', 'show', 'focus']);
  notification.handlers.close();
  assert.equal(activeNotifications.size, 0);
});
