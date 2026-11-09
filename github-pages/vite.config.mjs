import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: '../public',
  resolve: {
    alias: {'@': fileURLToPath(new URL('..', import.meta.url))},
  },
  plugins: [react()],
  css: { postcss: { plugins: { '@tailwindcss/postcss': {} } } },
  build: {
    outDir: '../out/pages',
    emptyOutDir: true,
  },
});
