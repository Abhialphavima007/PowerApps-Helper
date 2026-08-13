// Thin accessor for the preload-exposed API. When running the renderer in a
// plain browser (no Electron), `window.api` is undefined; callers should guard.
export const api = window.api;
export const hasApi = !!window.api;
