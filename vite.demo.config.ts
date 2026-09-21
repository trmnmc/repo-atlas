/**
 * Single-file build for the hosted demo at swarm.fenley.ai/projects/repo-atlas.
 *
 * The SWARM project route serves exactly one HTML file per project, so this
 * config inlines the script and stylesheet. Entry is demo.html ->
 * src/demo-main.tsx, which mounts the unmodified App over an in-browser
 * backend (src/demo/demoBackend.ts) serving shared/demoSnapshot.js.
 *
 * vite.config.ts is FROZEN and owns the Vitest contract; this file is
 * additive. outDir is dist-demo so a demo build can never clobber dist/, which
 * server/index.js serves. Build with:
 *   npm run build:demo   ->   dist-demo/demo.html
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: { input: 'demo.html' },
  },
});
