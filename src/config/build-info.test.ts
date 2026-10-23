import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_URL, getBuildInfo } from './build-info';

const SHA = '4f6af5f0c3b2a1d9e8f7a6b5c4d3e2f1a0b9c8d7';

describe('getBuildInfo', () => {
  it('links the commit and the CI run when CI provides them', () => {
    const info = getBuildInfo({
      VITE_COMMIT_SHA: SHA,
      VITE_RUN_ID: '1234567890',
      VITE_BUILD_TIME: '2026-10-23T16:00:00Z',
    });

    expect(info.sha).toBe(SHA);
    expect(info.shortSha).toBe('4f6af5f');
    expect(info.commitUrl).toBe(`${DEFAULT_REPO_URL}/commit/${SHA}`);
    expect(info.runId).toBe('1234567890');
    expect(info.runUrl).toBe(`${DEFAULT_REPO_URL}/actions/runs/1234567890`);
    expect(info.buildTime).toBe('2026-10-23T16:00:00.000Z');
  });

  it('falls back to safe labels with no links for a local build', () => {
    const info = getBuildInfo({});

    expect(info.sha).toBe('dev');
    expect(info.shortSha).toBe('dev');
    expect(info.commitUrl).toBeNull();
    expect(info.runId).toBe('local');
    expect(info.runUrl).toBeNull();
    expect(info.buildTime).toBe('unknown');
  });

  it('rejects values that are not a SHA or a numeric run id', () => {
    const info = getBuildInfo({
      VITE_COMMIT_SHA: 'javascript:alert(1)',
      VITE_RUN_ID: '12; rm -rf',
      VITE_BUILD_TIME: 'yesterday-ish',
    });

    expect(info.commitUrl).toBeNull();
    expect(info.runUrl).toBeNull();
    expect(info.shortSha).toBe('dev');
    expect(info.buildTime).toBe('unknown');
  });

  it('normalises an uppercase SHA with surrounding whitespace', () => {
    expect(getBuildInfo({ VITE_COMMIT_SHA: `  ${SHA.toUpperCase()}\n` }).sha).toBe(SHA);
  });

  it('accepts a GitHub repo override and ignores anything else', () => {
    expect(getBuildInfo({ VITE_REPO_URL: 'https://github.com/someone/fork/' }).repoUrl).toBe(
      'https://github.com/someone/fork',
    );
    expect(getBuildInfo({ VITE_REPO_URL: 'https://evil.example/x/y' }).repoUrl).toBe(DEFAULT_REPO_URL);
  });
});
