import { describe, expect, it } from 'vitest';
import { GOATCOUNTER_SCRIPT_SRC, goatCounterCode, goatCounterEndpoint, injectGoatCounter } from './analytics';

interface FakeScript {
  async?: boolean;
  src?: string;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

// Just enough of a Document for the injector; keeps the unit tests free of jsdom.
function fakeDocument() {
  const appended: FakeScript[] = [];
  return {
    appended,
    querySelector: (selector: string) =>
      selector === 'script[data-goatcounter]' ? (appended.find((s) => 'data-goatcounter' in s.attrs) ?? null) : null,
    createElement: (): FakeScript => {
      const attrs: Record<string, string> = {};
      return {
        attrs,
        setAttribute(name, value) {
          attrs[name] = value;
        },
      };
    },
    head: {
      appendChild: (node: FakeScript) => {
        appended.push(node);
        return node;
      },
    },
  };
}

describe('goatCounterCode', () => {
  it('returns a valid site code', () => {
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: 'jtmilan' })).toBe('jtmilan');
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: 'chaos-room-2' })).toBe('chaos-room-2');
  });

  it('treats missing or malformed codes as analytics off', () => {
    expect(goatCounterCode({})).toBeNull();
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: '' })).toBeNull();
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: 'evil.com/x' })).toBeNull();
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: 'UPPER' })).toBeNull();
    expect(goatCounterCode({ VITE_GOATCOUNTER_CODE: 'a'.repeat(64) })).toBeNull();
  });
});

describe('injectGoatCounter', () => {
  it('appends one async script pointing at the site endpoint', () => {
    const doc = fakeDocument();

    expect(injectGoatCounter(doc as unknown as Document, 'jtmilan')).toBe(true);
    expect(doc.appended).toHaveLength(1);
    expect(doc.appended[0]).toMatchObject({
      async: true,
      src: GOATCOUNTER_SCRIPT_SRC,
      attrs: { 'data-goatcounter': goatCounterEndpoint('jtmilan') },
    });
  });

  it('is idempotent', () => {
    const doc = fakeDocument();
    injectGoatCounter(doc as unknown as Document, 'jtmilan');

    expect(injectGoatCounter(doc as unknown as Document, 'jtmilan')).toBe(false);
    expect(doc.appended).toHaveLength(1);
  });
});
