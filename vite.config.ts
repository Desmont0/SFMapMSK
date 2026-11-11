import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host:'localhost', proxy: { '/api': 'http://127.0.0.1:3000', '/avatars': 'http://127.0.0.1:3000' } }, build: { sourcemap: false, rollupOptions: { output: { manualChunks: { maplibre:['maplibre-gl'], react:['react','react-dom/client'] } } } } });
