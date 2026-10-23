import { describe, expect, it } from 'vitest';
import { parseDeepLink, SCENARIOS } from './scenarios.ts';
import { parseMode } from './modes.ts';

describe('parseDeepLink', () => {
  it('maps every allowlisted scenario to its chaos command', () => {
    expect(parseDeepLink('#scenario=pod-kill')).toEqual({ kind: 'scenario', name: 'pod-kill', command: { type: 'killPod' } });
    expect(parseDeepLink('#scenario=error-burst')).toEqual({
      kind: 'scenario',
      name: 'error-burst',
      command: { type: 'injectErrors', ratio: 0.2, durationMs: 30_000 },
    });
    expect(parseDeepLink('#scenario=surge')).toMatchObject({ command: { type: 'trafficSurge' } });
    expect(parseDeepLink('#scenario=latency')).toMatchObject({ command: { type: 'injectLatency' } });
    expect(parseDeepLink('#scenario=db-failover')).toMatchObject({ command: { type: 'failoverDatabase' } });
    expect(Object.keys(SCENARIOS)).toHaveLength(5);
  });

  it('hands out a fresh command each time (callers can never mutate the presets)', () => {
    const a = parseDeepLink('#scenario=surge');
    const b = parseDeepLink('#scenario=surge');
    expect(a && 'command' in a && b && 'command' in b && a.command !== b.command).toBe(true);
  });

  it('opens the console and runs nothing for unknown or crafted names', () => {
    for (const hash of ['#scenario=', '#scenario=rm-rf', '#scenario=__proto__', '#scenario=toString', '#scenario=POD-KILL', '#scenario=pod-kill&x=1', '#scenario=%3Cscript%3E']) {
      expect(parseDeepLink(hash), hash).toEqual({ kind: 'console' });
    }
  });

  it('recognises #tour and #console, and ignores everything else', () => {
    expect(parseDeepLink('#tour')).toEqual({ kind: 'tour' });
    expect(parseDeepLink('#console')).toEqual({ kind: 'console' });
    for (const hash of ['', '#', '#hero', '#tours', '#Tour']) expect(parseDeepLink(hash), hash).toBeNull();
  });

  it('every deep link starts the page in console mode', () => {
    expect(parseMode({ hash: '#tour', search: '' })).toBe('console');
    expect(parseMode({ hash: '#scenario=surge', search: '' })).toBe('console');
    expect(parseMode({ hash: '#scenario=nope', search: '' })).toBe('console');
    expect(parseMode({ hash: '#tours', search: '' })).toBe('hero');
  });
});
