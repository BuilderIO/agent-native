/**
 * Browser-safe accessors for optional Node builtins.
 *
 * `node:async_hooks` and `node:events` are server-only, but the modules that
 * use them (db telemetry, settings/resource emitters) can land in the browser
 * dev graph before tree-shaking runs. A static `import { X } from "node:..."`
 * resolves to Vite's externalized stub and throws the instant the value is
 * touched at module load. We read the builtin through `process.getBuiltinModule`
 * instead — the same guard `server/request-context.ts` uses — so there is no
 * static `node:` import to evaluate in the browser, and callers fall back to a
 * no-op on non-Node runtimes (browser, or Node without getBuiltinModule).
 */
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

/**
 * Returns a real Node EventEmitter on Node, or a no-op emitter elsewhere. The
 * emitters that use this drive server-side SSE fan-out; nothing subscribes in
 * the browser, so the no-op fallback is inert rather than wrong.
 */
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
