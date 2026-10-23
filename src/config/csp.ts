import { GOATCOUNTER_CODE_PATTERN } from './analytics.ts';

export interface CspOptions {
  goatCounterCode: string | null;
}

// Directive order is fixed so the emitted policy is stable across builds.
export function buildCsp({ goatCounterCode }: CspOptions): string {
  if (goatCounterCode !== null && !GOATCOUNTER_CODE_PATTERN.test(goatCounterCode)) {
    throw new Error(`invalid GoatCounter code: ${JSON.stringify(goatCounterCode)}`);
  }
  const counterHost = goatCounterCode ? [`https://${goatCounterCode}.goatcounter.com`] : [];
  const counterScript = goatCounterCode ? ['https://gc.zgo.at'] : [];

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...counterScript]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:', ...counterHost]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...counterHost]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'none'"]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

export function cspMetaTag(policy: string): string {
  const escaped = policy.replace(/[&"'<>]/g, (ch) => ATTRIBUTE_ESCAPES[ch] ?? ch);
  return `<meta http-equiv="Content-Security-Policy" content="${escaped}">`;
}
