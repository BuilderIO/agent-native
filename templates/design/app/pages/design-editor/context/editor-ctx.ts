/**
 * The stable spine editor commands read instead of closing over render values.
 *
 * `DesignEditor` owns ~105 state and ref cells that cross-domain transactions
 * (undo, redo, paste, delete) all touch at once. Passing those as hook
 * arguments means 25+ inputs and a dep array that invalidates on every
 * keystroke, so commands take this one object whose identity never changes and
 * whose reads always resolve to the current render.
 */

type AnyFunction = (...args: never[]) => unknown;

/** A ref whose `current` is reassigned during every render. */
export interface LatestRef<T> {
  readonly current: T;
}

/** Value slots reached as `ctx.get.activeFile()`. */
export type LatestGetters<T> = {
  readonly [K in keyof T]-?: () => T[K];
};

/** Callback slots reached as `ctx.services.queueFileContentSave(args)`. */
export type LatestInvokers<T> = {
  readonly [K in keyof T]: T[K];
};

/**
 * Both builders enumerate keys once, from the snapshot present when the editor
 * first renders. That is only safe because the caller assigns `latest.current`
 * from a single object literal with a fixed key set — a conditionally-present
 * key would be missing an accessor for the life of the component.
 */
function keysOf<T extends object>(snapshot: T): (keyof T & string)[] {
  return Object.keys(snapshot) as (keyof T & string)[];
}

export function createLatestGetters<T extends object>(
  latest: LatestRef<T>,
): LatestGetters<T> {
  const getters: Record<string, () => unknown> = {};
  for (const key of keysOf(latest.current)) {
    getters[key] = () => latest.current[key];
  }
  return Object.freeze(getters) as LatestGetters<T>;
}

/**
 * Forwards to whichever function is current at call time, so a command can
 * invoke `ctx.services.foo(...)` without the caller re-reading the ref.
 */
export function createLatestInvokers<T extends Record<string, AnyFunction>>(
  latest: LatestRef<T>,
): LatestInvokers<T> {
  const invokers: Record<string, AnyFunction> = {};
  for (const key of keysOf(latest.current)) {
    invokers[key] = ((...args: never[]) =>
      latest.current[key](...args)) as AnyFunction;
  }
  return Object.freeze(invokers) as LatestInvokers<T>;
}
