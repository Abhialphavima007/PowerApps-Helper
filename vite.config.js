import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build. base './' so file:// paths resolve when packaged.
export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
