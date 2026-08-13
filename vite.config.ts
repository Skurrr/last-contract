import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// base is set for GitHub Pages project-site hosting; override with VITE_BASE for other hosts.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/last-contract/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
