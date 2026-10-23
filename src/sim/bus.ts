type Handler<E> = (event: E) => void;

export interface Bus<E extends { type: string }> {
  on<K extends E['type']>(type: K, handler: Handler<Extract<E, { type: K }>>): () => void;
  onAny(handler: Handler<E>): () => void;
  emit(event: E): void;
}

// The only contract between the simulator and anything that draws it. A real backend
// (Kubernetes watch, Prometheus over SSE) can publish the same events later.
export function createBus<E extends { type: string }>(
  onError: (error: unknown) => void = (error) => console.error('[bus] handler failed', error),
): Bus<E> {
  const byType = new Map<string, Set<Handler<E>>>();
  const any = new Set<Handler<E>>();

  const deliver = (handler: Handler<E>, event: E) => {
    try {
      handler(event);
    } catch (error) {
      onError(error);
    }
  };

  return {
    on(type, handler) {
      const set = byType.get(type) ?? new Set<Handler<E>>();
      byType.set(type, set);
      set.add(handler as Handler<E>);
      return () => {
        set.delete(handler as Handler<E>);
      };
    },
    onAny(handler) {
      any.add(handler);
      return () => {
        any.delete(handler);
      };
    },
    emit(event) {
      byType.get(event.type)?.forEach((handler) => deliver(handler, event));
      any.forEach((handler) => deliver(handler, event));
    },
  };
}
