export interface AppStateEvent {
  [key: string]: unknown;
  source: "app-state";
  type: "change" | "delete";
  key: string;
  owner?: string;
  requestSource?: string;
}

export type AppStateEventListener = (event: AppStateEvent) => void;

export interface AppStateEmitter {
  on(event: "app-state", listener: AppStateEventListener): this;
  off(event: "app-state", listener: AppStateEventListener): this;
  removeListener(event: "app-state", listener: AppStateEventListener): this;
  emit(event: "app-state", payload: AppStateEvent): boolean;
}

class SimpleAppStateEmitter implements AppStateEmitter {
  private readonly listeners = new Set<AppStateEventListener>();

  on(event: "app-state", listener: AppStateEventListener): this {
    if (event === "app-state") this.listeners.add(listener);
    return this;
  }

  off(event: "app-state", listener: AppStateEventListener): this {
    if (event === "app-state") this.listeners.delete(listener);
    return this;
  }

  removeListener(event: "app-state", listener: AppStateEventListener): this {
    return this.off(event, listener);
  }

  emit(event: "app-state", payload: AppStateEvent): boolean {
    if (event !== "app-state") return false;
    for (const listener of this.listeners) listener(payload);
    return this.listeners.size > 0;
  }
}

/**
 * Singleton emitter for application-state DB changes.
 * The SSE handler subscribes to this via extraEmitters.
 */
const _emitter = new SimpleAppStateEmitter();

export function getAppStateEmitter(): AppStateEmitter {
  return _emitter;
}

export function emitAppStateChange(
  key: string,
  requestSource?: string,
  owner?: string,
): void {
  const event: AppStateEvent = {
    source: "app-state",
    type: "change",
    key,
    ...(owner && { owner }),
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("app-state", event);
}

export function emitAppStateDelete(
  key: string,
  requestSource?: string,
  owner?: string,
): void {
  const event: AppStateEvent = {
    source: "app-state",
    type: "delete",
    key,
    ...(owner && { owner }),
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("app-state", event);
}
