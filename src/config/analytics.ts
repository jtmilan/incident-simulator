export interface AnalyticsEnv {
  readonly VITE_GOATCOUNTER_CODE?: string;
}

export const GOATCOUNTER_SCRIPT_SRC = 'https://gc.zgo.at/count.js';

// GoatCounter site codes become a subdomain, so the same pattern also keeps
// the CSP host exact (see csp.ts).
export const GOATCOUNTER_CODE_PATTERN = /^[a-z0-9-]{1,63}$/;

export function goatCounterCode(env: AnalyticsEnv): string | null {
  const code = env.VITE_GOATCOUNTER_CODE?.trim() ?? '';
  return GOATCOUNTER_CODE_PATTERN.test(code) ? code : null;
}

export function goatCounterEndpoint(code: string): string {
  return `https://${code}.goatcounter.com/count`;
}

export function injectGoatCounter(doc: Document, code: string): boolean {
  if (doc.querySelector('script[data-goatcounter]')) return false;

  const script = doc.createElement('script');
  script.async = true;
  script.src = GOATCOUNTER_SCRIPT_SRC;
  script.setAttribute('data-goatcounter', goatCounterEndpoint(code));
  doc.head.appendChild(script);
  return true;
}
