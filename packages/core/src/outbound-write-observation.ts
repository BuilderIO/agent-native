import { noteObservedWrite, observingWrites } from "./action-frame.js";

/**
 * The write an action sends over HTTP is seen here, because no other layer can
 * see it: a call that fails after a provider accepted its POST must not read as
 * one that saved nothing. Every request that is not a plain read counts, and
 * an unrecognised method is a write. Bookkeeping that is not a write the call
 * exists to make, such as analytics, wraps its fetch in
 * `withoutWriteObservation`.
 */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reaches the fetch a wrapper replaced, so another copy of this module can walk the chain. */
const WRAPPED_FETCH = Symbol.for("agent-native.outboundWriteObservation.wraps");
const wrappers = new WeakSet<object>();

export type OutboundWriteObservation =
  /** `globalThis.fetch` is, or now is, this module's wrapper. */
  | "observing"
  /** A browser: nothing in the page runs an action invocation. */
  | "not-server"
  | "fetch-missing"
  /** `globalThis.fetch` refused the wrapper; HTTP writes go unseen. */
  | "fetch-unwritable";

let warnedUnobserved = false;

function warnOnce(reason: string): void {
  if (warnedUnobserved) return;
  warnedUnobserved = true;
  console.warn(
    `[agent-native] Outbound HTTP writes are not observed (${reason}); a write action that fails after sending one will be classified as having saved nothing.`,
  );
}

function methodOf(input: unknown, init: unknown): string | undefined {
  const own =
    init !== null && typeof init === "object"
      ? (init as { method?: unknown }).method
      : undefined;
  if (own !== undefined) return typeof own === "string" ? own : undefined;
  if (input !== null && typeof input === "object") {
    const inherited = (input as { method?: unknown }).method;
    if (inherited !== undefined) {
      return typeof inherited === "string" ? inherited : undefined;
    }
  }
  return "GET";
}

function noteIfWrite(input: unknown, init: unknown): void {
  try {
    if (!observingWrites()) return;
    const method = methodOf(input, init);
    if (method === undefined || !READ_METHODS.has(method.toUpperCase())) {
      noteObservedWrite("http");
    }
  } catch {
    // A request whose method cannot be read is not known to be a read.
    noteObservedWrite("http");
  }
}

function isWrapped(candidate: unknown): boolean {
  for (
    let f: unknown = candidate;
    typeof f === "function";
    f = (f as { [WRAPPED_FETCH]?: unknown })[WRAPPED_FETCH]
  ) {
    if (wrappers.has(f)) return true;
  }
  return false;
}

/**
 * Make sure the running process's `fetch` reports the writes sent through it
 * to the action call that sent them. Called each time an invocation opens its
 * frame: a `fetch` something replaced since is wrapped again, so the
 * observation is not lost to whoever swapped it last. Never throws; the result
 * says whether writes are seen, and what is not seen is warned about once.
 */
export function observeOutboundWrites(): OutboundWriteObservation {
  if (typeof window !== "undefined") return "not-server";
  const original: unknown = globalThis.fetch;
  if (typeof original !== "function") {
    warnOnce("fetch is not available");
    return "fetch-missing";
  }
  if (isWrapped(original)) return "observing";
  const wrapper = function fetch(this: unknown, ...args: unknown[]) {
    noteIfWrite(args[0], args[1]);
    return Reflect.apply(original, this, args);
  };
  try {
    // Own properties such as Bun's `preconnect`, or a test double's spy API.
    for (const key of Reflect.ownKeys(original)) {
      if (
        key === "length" ||
        key === "name" ||
        key === "prototype" ||
        key === WRAPPED_FETCH
      ) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (descriptor) Object.defineProperty(wrapper, key, descriptor);
    }
    Object.defineProperty(wrapper, "name", { value: original.name });
    Object.defineProperty(wrapper, WRAPPED_FETCH, { value: original });
    wrappers.add(wrapper);
    globalThis.fetch = wrapper as typeof globalThis.fetch;
  } catch {
    warnOnce("fetch cannot be replaced");
    return "fetch-unwritable";
  }
  if (globalThis.fetch !== wrapper) {
    warnOnce("fetch cannot be replaced");
    return "fetch-unwritable";
  }
  return "observing";
}
