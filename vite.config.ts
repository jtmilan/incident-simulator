import { execSync } from 'node:child_process';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { goatCounterCode } from './src/config/analytics.ts';
import { getBuildInfo } from './src/config/build-info.ts';
import { buildCsp, cspMetaTag } from './src/config/csp.ts';

function git(args: string): string {
  return execSync(`git ${args}`, {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH ?? '' },
    timeout: 5_000,
  })
    .toString()
    .trim();
}

// Provenance is resolved once, at config time. CI passes the real values. A local build
// names the checked-out commit only when the tree is clean; uncommitted changes are "dev",
// because no commit actually contains that code.
function resolveCommitSha(): string {
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA;
  try {
    return git('status --porcelain') === '' ? git('rev-parse HEAD') : 'dev';
  } catch {
    return 'dev';
  }
}

process.env.VITE_COMMIT_SHA = resolveCommitSha();
process.env.VITE_BUILD_TIME ??= new Date().toISOString();

// GitHub Pages can't send response headers, so the CSP ships as a <meta> tag.
// Build-only: the dev server injects styles from JS for HMR, which this policy would block.
// The build-commit meta lets the post-deploy check confirm the CDN is serving this exact commit.
// `env` is the same VITE_* set the bundle sees (.env files + process.env), so the policy and
// the analytics injection can never disagree.
function headMetaPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'chaos-control-room:head-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = buildCsp({ goatCounterCode: goatCounterCode(env) });
        const commit = getBuildInfo(env).sha;
        return html.replace(
          '<head>',
          `<head>\n    ${cspMetaTag(policy)}\n    <meta name="build-commit" content="${commit}">`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/chaos-control-room/',
  plugins: [headMetaPlugin(loadEnv(mode, process.cwd(), 'VITE_'))],
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
      include: ['src/config/**/*.ts', 'src/sim/**/*.ts', 'src/app/loop.ts', 'src/app/gpu.ts', 'src/ui/modes.ts', 'src/ui/status-strip.ts', 'src/ui/view-models.ts', 'src/scene/{quality,layout,palette,particles}.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90 },
    },
  },
}));
