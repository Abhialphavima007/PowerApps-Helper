import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { api, hasApi } from './api.js';
import { loadTheme } from './theme.mjs';
import './styles.css';

// Restore the local preference before rendering to avoid a flash of the other theme.
loadTheme(hasApi ? api.settings : null).then((initialTheme) => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App initialTheme={initialTheme} />
    </React.StrictMode>
  );
});
