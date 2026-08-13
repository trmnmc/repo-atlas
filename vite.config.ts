/**
 * Repo Atlas — Vite + Vitest configuration (FROZEN after wave 1).
 *
 * The test timezone is PINNED to America/Chicago via `test.env` so the
 * local-timezone day-bucketing assertions in shared/contract.test.js (and
 * every suite that uses dayKey) behave identically on every machine.
 * Vitest runs non-interactively via `npm test` (`vitest run`).
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'shared/**/*.test.js',
      'src/**/*.test.{js,jsx,ts,tsx}',
      'server/**/*.test.js',
    ],
    env: {
      TZ: 'America/Chicago',
    },
  },
});
