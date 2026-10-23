export const DEFAULT_REPO_URL = 'https://github.com/jtmilan/chaos-control-room';

export interface BuildEnv {
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_RUN_ID?: string;
  readonly VITE_BUILD_TIME?: string;
  readonly VITE_REPO_URL?: string;
}

export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitUrl: string | null;
  runId: string;
  runUrl: string | null;
  buildTime: string;
  repoUrl: string;
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const RUN_ID_PATTERN = /^\d+$/;
const GITHUB_REPO_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;

// Everything here ends up in href attributes on the live page, so anything that
// doesn't look exactly like a SHA, run id or GitHub repo is dropped rather than escaped.
export function getBuildInfo(env: BuildEnv): BuildInfo {
  const repoCandidate = env.VITE_REPO_URL?.trim().replace(/\/+$/, '') ?? '';
  const repoUrl = GITHUB_REPO_PATTERN.test(repoCandidate) ? repoCandidate : DEFAULT_REPO_URL;

  const shaCandidate = env.VITE_COMMIT_SHA?.trim().toLowerCase() ?? '';
  const hasSha = SHA_PATTERN.test(shaCandidate);

  const runCandidate = env.VITE_RUN_ID?.trim() ?? '';
  const hasRun = RUN_ID_PATTERN.test(runCandidate);

  const parsedTime = env.VITE_BUILD_TIME ? new Date(env.VITE_BUILD_TIME) : null;
  const buildTime = parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime.toISOString() : 'unknown';

  return {
    sha: hasSha ? shaCandidate : 'dev',
    shortSha: hasSha ? shaCandidate.slice(0, 7) : 'dev',
    commitUrl: hasSha ? `${repoUrl}/commit/${shaCandidate}` : null,
    runId: hasRun ? runCandidate : 'local',
    runUrl: hasRun ? `${repoUrl}/actions/runs/${runCandidate}` : null,
    buildTime,
    repoUrl,
  };
}
