import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { goatCounterCode } from './src/config/analytics.ts';
import { getBuildInfo } from './src/config/build-info.ts';
import { buildCsp, cspMetaTag } from './src/config/csp.ts';

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

// GitHub Pages can't send response headers, so the CSP ships as a <meta> tag.
// Build-only: the dev server injects styles from JS for HMR, which this policy would block.
// The build-commit meta lets the post-deploy check confirm the CDN is serving this exact commit.
function headMetaPlugin(): Plugin {
  return {
    name: 'chaos-control-room:head-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = buildCsp({ goatCounterCode: goatCounterCode(process.env) });
        const commit = getBuildInfo(process.env).sha;
        return html.replace(
          '<head>',
          `<head>\n    ${cspMetaTag(policy)}\n    <meta name="build-commit" content="${commit}">`,
        );
      },
    },
  };
}

export default defineConfig({
  base: '/chaos-control-room/',
  plugins: [headMetaPlugin()],
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
