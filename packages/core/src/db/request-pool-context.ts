import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestDbPool {
  end(): Promise<unknown>;
}

interface PoolRequestScope {
  readonly pools: Map<string, RequestDbPool>;
  readonly finalizers: Array<() => void>;
  leases: number;
  closing: boolean;
  closePromise?: Promise<void>;
}

interface WaitUntilRequest {
  waitUntil?: (promise: Promise<unknown>) => void;
}

const storage = new AsyncLocalStorage<PoolRequestScope>();

function createScope(): PoolRequestScope {
  return {
    pools: new Map(),
    finalizers: [],
    leases: 1,
    closing: false,
  };
}

function acquireLease(scope: PoolRequestScope): () => Promise<void> {
  if (scope.closing) {
    throw new Error("The request database pool scope has already closed.");
  }
  scope.leases += 1;
  let active = true;
  return async () => {
    if (!active) return;
    active = false;
    await releaseLease(scope);
  };
}

async function closeScope(scope: PoolRequestScope): Promise<void> {
  if (scope.closePromise) return scope.closePromise;
  scope.closing = true;
  const pools = [...scope.pools.values()];
  scope.pools.clear();
  const results = await Promise.allSettled(pools.map((pool) => pool.end()));
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  for (const finalize of scope.finalizers) {
    try {
      finalize();
    } catch (error) {
      failures.push(error);
    }
  }
  scope.finalizers.length = 0;
  if (failures.length) {
    throw new AggregateError(
      failures,
      "Could not close request database pools",
    );
  }
}

async function releaseLease(scope: PoolRequestScope): Promise<void> {
  if (scope.leases <= 0) return;
  scope.leases -= 1;
  if (scope.leases === 0) {
    scope.closePromise = closeScope(scope);
    await scope.closePromise;
  }
}

export function getCurrentRequestDbPoolScope(): PoolRequestScope | undefined {
  return storage.getStore();
}

/**
 * Keeps the request pool that owns a shared initialization promise alive until
 * its work settles, even if the request stops awaiting it first.
 */
export function retainRequestDbPoolScope<T>(promise: Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return promise;
  const release = acquireLease(scope);
  return promise.finally(release);
}

export function getOrCreateRequestDbPool<T extends RequestDbPool>(
  key: string,
  create: () => T,
): T {
  const scope = storage.getStore();
  if (!scope) {
    throw new Error(
      "Cloudflare database pools can only be used inside a request scope.",
    );
  }
  if (scope.closing) {
    throw new Error("The request database pool scope has already closed.");
  }
  const existing = scope.pools.get(key);
  if (existing) return existing as T;
  const pool = create();
  scope.pools.set(key, pool);
  return pool;
}

export function replaceRequestDbPool(
  key: string,
  previous: RequestDbPool,
  next: RequestDbPool,
): boolean {
  const scope = storage.getStore();
  if (!scope || scope.closing || scope.pools.get(key) !== previous)
    return false;
  scope.pools.set(key, next);
  return true;
}

export function getRequestDbPool(key: string): RequestDbPool | undefined {
  return storage.getStore()?.pools.get(key);
}

function wrapStream(
  stream: ReadableStream<Uint8Array>,
  scope: PoolRequestScope,
): ReadableStream<Uint8Array> {
  const release = acquireLease(scope);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (error) {
    void release();
    throw error;
  }

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    await release();
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const result = await storage.run(scope, () => reader.read());
          if (result.done) {
            await finish();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          await finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await storage.run(scope, () => reader.cancel(reason));
        } finally {
          await finish();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

function holdResponseStream(value: unknown, scope: PoolRequestScope): unknown {
  if (
    typeof ReadableStream !== "undefined" &&
    value instanceof ReadableStream
  ) {
    return wrapStream(value as ReadableStream<Uint8Array>, scope);
  }
  if (typeof Response === "undefined" || !(value instanceof Response)) {
    return value;
  }
  if (!value.body) return value;
  return new Response(wrapStream(value.body, scope), {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });
}

function installWaitUntil(
  request: WaitUntilRequest | undefined,
  scope: PoolRequestScope,
): () => void {
  const waitUntil = request?.waitUntil;
  if (typeof waitUntil !== "function" || !request) return () => {};

  const previousDescriptor = Object.getOwnPropertyDescriptor(
    request,
    "waitUntil",
  );
  const wrapped = function (this: WaitUntilRequest, promise: Promise<unknown>) {
    const release = acquireLease(scope);
    const trackedPromise = Promise.resolve(promise).finally(release);
    try {
      return waitUntil.call(request, trackedPromise);
    } catch (error) {
      void trackedPromise.catch(() => {});
      throw error;
    }
  };

  try {
    Object.defineProperty(request, "waitUntil", {
      configurable: true,
      enumerable: previousDescriptor?.enumerable ?? true,
      writable: true,
      value: wrapped,
    });
  } catch (error) {
    throw new Error(
      "Cloudflare request waitUntil cannot be wrapped to keep database pools alive.",
      { cause: error },
    );
  }

  return () => {
    if (request.waitUntil !== wrapped) return;
    if (previousDescriptor) {
      Object.defineProperty(request, "waitUntil", previousDescriptor);
    } else {
      delete (request as { waitUntil?: (promise: Promise<unknown>) => void })
        .waitUntil;
    }
  };
}

/**
 * Gives a Cloudflare request its own database pools and keeps them alive while
 * the handler, a returned response stream, or registered waitUntil work runs.
 */
export function runWithRequestDbPoolScope<T>(
  enabled: boolean,
  request: WaitUntilRequest | undefined,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (!enabled) return fn();

  const scope = createScope();
  const restoreWaitUntil = installWaitUntil(request, scope);
  scope.finalizers.push(restoreWaitUntil);
  return storage.run(scope, async () => {
    try {
      const result = await fn();
      return holdResponseStream(result, scope) as T;
    } finally {
      await releaseLease(scope);
    }
  });
}
