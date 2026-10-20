import type { AsyncLocalStorage } from "node:async_hooks";
import type { EventEmitter } from "node:events";

type BuiltinProcess = {
  versions?: { node?: string };
  getBuiltinModule?: (name: string) => unknown;
};

function nodeBuiltin<T>(name: string): T | undefined {
  const proc =
    typeof process === "undefined" ? undefined : (process as BuiltinProcess);
  if (
    typeof window !== "undefined" ||
    !proc ||
    !proc.versions?.node ||
    typeof proc.getBuiltinModule !== "function"
  ) {
    return undefined;
  }
  return proc.getBuiltinModule(name) as T | undefined;
}

export type AsyncLocalStorageCtor = new <T>() => AsyncLocalStorage<T>;

export function getAsyncLocalStorageCtor(): AsyncLocalStorageCtor | undefined {
  return nodeBuiltin<{ AsyncLocalStorage: AsyncLocalStorageCtor }>(
    "node:async_hooks",
  )?.AsyncLocalStorage;
}

type EventEmitterCtor = new () => EventEmitter;

export function createEventEmitter(): EventEmitter {
  const Ctor = nodeBuiltin<{ EventEmitter: EventEmitterCtor }>(
    "node:events",
  )?.EventEmitter;
  if (Ctor) return new Ctor();
  const noop = {
    on: () => noop,
    off: () => noop,
    once: () => noop,
    addListener: () => noop,
    removeListener: () => noop,
    removeAllListeners: () => noop,
    setMaxListeners: () => noop,
    emit: () => false,
  };
  return noop as unknown as EventEmitter;
}
