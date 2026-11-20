export function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme, root = document.documentElement) {
  root.dataset.theme = normalizeTheme(theme);
}

export async function loadTheme(settingsApi, root = document.documentElement) {
  let theme = 'dark';
  try {
    if (settingsApi) theme = normalizeTheme((await settingsApi.get()).theme);
  } catch {
    // Settings may be unavailable; the existing dark palette remains usable.
  }
  applyTheme(theme, root);
  return theme;
}
