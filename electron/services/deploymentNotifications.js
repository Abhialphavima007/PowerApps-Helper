'use strict';

function createDeploymentNotifier({ Notification, getWindow, activeNotifications = new Set() }) {
  return (title, message) => {
    const text = String(message || '').slice(0, 220);
    const normalizedTitle = String(title || 'Deployment update');
    const level = /stopped|failed/i.test(normalizedTitle)
      ? 'error'
      : /attention|warning/i.test(normalizedTitle) ? 'warning' : 'success';
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: normalizedTitle,
      message: text,
      level,
      createdAt: Date.now()
    };

    // Always publish an in-app alert, even when the operating system cannot show
    // native notifications or the user has disabled them.
    try {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('deployment:notification', payload);
    } catch { /* The deployment result remains visible in the Deploy view. */ }

    try {
      if (!Notification || !Notification.isSupported()) return payload;
      const notification = new Notification({
        title: `PowerApps Helper — ${normalizedTitle}`,
        body: text,
        silent: false
      });
      activeNotifications.add(notification);
      notification.on('close', () => activeNotifications.delete(notification));
      notification.on('click', () => {
        const window = getWindow();
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });
      notification.show();
    } catch { /* In-app notifications still cover native notification failures. */ }

    return payload;
  };
}

module.exports = { createDeploymentNotifier };
