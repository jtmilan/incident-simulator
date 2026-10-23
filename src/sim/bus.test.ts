import { describe, expect, it, vi } from 'vitest';
import { createBus } from './bus.ts';

type TestEvent = { type: 'ping'; n: number } | { type: 'pong'; label: string };

describe('createBus', () => {
  it('delivers typed events to their handlers in subscription order, then to onAny', () => {
    const bus = createBus<TestEvent>();
    const seen: string[] = [];
    bus.on('ping', (e) => seen.push(`first:${e.n}`));
    bus.on('ping', (e) => seen.push(`second:${e.n}`));
    bus.on('pong', (e) => seen.push(`pong:${e.label}`));
    bus.onAny((e) => seen.push(`any:${e.type}`));

    bus.emit({ type: 'ping', n: 1 });
    bus.emit({ type: 'pong', label: 'x' });

    expect(seen).toEqual(['first:1', 'second:1', 'any:ping', 'pong:x', 'any:pong']);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createBus<TestEvent>();
    const handler = vi.fn();
    const any = vi.fn();
    const off = bus.on('ping', handler);
    const offAny = bus.onAny(any);

    off();
    offAny();
    bus.emit({ type: 'ping', n: 2 });

    expect(handler).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });

  it('isolates a throwing handler from the rest', () => {
    const onError = vi.fn();
    const bus = createBus<TestEvent>(onError);
    const after = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', after);

    bus.emit({ type: 'ping', n: 3 });

    expect(after).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });
});
