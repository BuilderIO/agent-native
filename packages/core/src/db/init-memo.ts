import { peekRequestScope } from "../server/request-context.js";

/**
 * Memoize a one-time schema-init routine without ever handing one invocation a
 * pending promise created by another.
 *
 * Workers ties every I/O object to the request that created it, and module
 * scope outlives a request. So an init kicked off at plugin-init time — or by a
 * request that returned before its DDL settled — leaves a promise that can
 * never settle: not resolved, not rejected, just abandoned. A plain
 * `_initPromise ??= run()` memo then hands that corpse to every later caller,
 * and each one awaits forever. There is no error to catch and nothing in the
 * logs; the request simply never answers. That is how a single fire-and-forget
 * `ensureTables()` at startup silently killed every agent chat turn on D1.
 *
 * The rule this encodes: share a PENDING init only inside the invocation that
 * started it; share a SETTLED one with everybody. The routines wrapped here are
 * idempotent `CREATE TABLE IF NOT EXISTS` DDL, so a redundant second run costs
 * a round trip — cheap next to a turn that hangs until the client gives up.
 */
export interface InitMemo {
  (): Promise<void>;
  /** Drop the cached result so the next call re-runs the init. */
  reset(): void;
}

export function createInitMemo(init: () => Promise<void>): InitMemo {
  let ready = false;
  let inflight:
    | { scope: object | undefined; promise: Promise<void> }
    | undefined;

  const memo = async (): Promise<void> => {
    if (ready) return;

    const scope = peekRequestScope();
    // `scope === undefined` means no request context (plugin init, queue
    // consumer, CLI). Two such callers cannot be proven to share an invocation,
    // so they do not share a promise either.
    if (inflight && scope !== undefined && inflight.scope === scope) {
      return inflight.promise;
    }

    const promise = init().then(
      () => {
        ready = true;
        inflight = undefined;
      },
      (err) => {
        inflight = undefined;
        throw err;
      },
    );
    inflight = { scope, promise };
    return promise;
  };

  memo.reset = () => {
    ready = false;
    inflight = undefined;
  };

  return memo;
}
