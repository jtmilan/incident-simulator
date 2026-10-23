import { describe, expect, it } from 'vitest';
import { buildCsp, cspMetaTag } from './csp';

describe('buildCsp', () => {
  it('allows only same-origin resources when analytics is off', () => {
    expect(buildCsp({ goatCounterCode: null })).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; '),
    );
  });

  it('adds the GoatCounter script host and the exact site host, never a wildcard', () => {
    const policy = buildCsp({ goatCounterCode: 'jtmilan' });

    expect(policy).toContain("script-src 'self' https://gc.zgo.at");
    expect(policy).toContain("img-src 'self' data: https://jtmilan.goatcounter.com");
    expect(policy).toContain("connect-src 'self' https://jtmilan.goatcounter.com");
    expect(policy).not.toContain('*');
  });

  it('refuses a site code that could widen the policy', () => {
    expect(() => buildCsp({ goatCounterCode: "x.com 'unsafe-inline'" })).toThrow(/invalid GoatCounter code/);
  });
});

describe('cspMetaTag', () => {
  it('renders an http-equiv meta tag with the policy escaped', () => {
    expect(cspMetaTag(`default-src 'self'`)).toBe(
      `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;">`,
    );
    expect(cspMetaTag('a"b<c>&')).toContain('content="a&quot;b&lt;c&gt;&amp;"');
  });
});
