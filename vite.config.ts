import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Provenance is resolved once, at config time. CI passes the real values;
// a local build falls back to the checked-out commit so the footer still means something.
function resolveCommitSha(): string {
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH ?? '' },
      timeout: 5_000,
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

process.env.VITE_COMMIT_SHA = resolveCommitSha();
process.env.VITE_BUILD_TIME ??= new Date().toISOString();

export default defineConfig({
  base: '/chaos-control-room/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/config/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90 },
    },
  },
});
