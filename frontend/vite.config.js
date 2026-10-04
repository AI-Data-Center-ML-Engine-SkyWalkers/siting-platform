import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run dev`: proxies /api to the FastAPI backend on :8000.
// `npm run build`: static files in dist/, which FastAPI serves at /.
// `npm run build:preview`: one self-contained HTML file with sample data (for sharing a demo).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'preview' ? [react(), viteSingleFile()] : [react()],
  base: mode === 'preview' ? './' : '/',
  build: { outDir: mode === 'preview' ? 'dist-preview' : 'dist' },
  optimizeDeps: {
    include: ['react-globe.gl', 'three', 'mapbox-gl'],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
}));
