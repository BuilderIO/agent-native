import { afterEach, describe, expect, it, vi } from "vitest";

type Pool = {
  id: string;
  query: () => Promise<string>;
  end: () => Promise<void>;
};

const workerGlobal = globalThis as typeof globalThis & { __env__?: unknown };

describe("Cloudflare request database pool scope", () => {
  afterEach(() => {
    delete workerGlobal.__env__;
    vi.resetModules();
  });

  it("routes overlapping requests to separate pools and closes both after handlers", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const created: Pool[] = [];
    const makePool = () => {
      const pool: Pool = {
        id: `pool-${created.length + 1}`,
        query: vi.fn(async () => pool.id),
        end: vi.fn(async () => {}),
      };
      created.push(pool);
      return pool;
    };
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      makePool,
    );
    let releaseRequests!: () => void;
    const requestsReady = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let readyCount = 0;
    let markReady!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      markReady = resolve;
    });

    const runRequest = () =>
      runWithRequestDbPoolScope(true, undefined, async () => {
        const value = await facade.query();
        readyCount += 1;
        if (readyCount === 2) markReady();
        await requestsReady;
        return value;
      });

    const first = runRequest();
    const second = runRequest();
    await bothReady;

    expect(created).toHaveLength(2);
    expect(new Set(created.map((pool) => pool.id)).size).toBe(2);
    expect(created.every((pool) => pool.end.mock.calls.length === 0)).toBe(
      true,
    );

    releaseRequests();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "pool-1",
      "pool-2",
    ]);
    expect(created.map((pool) => pool.end.mock.calls.length)).toEqual([1, 1]);
  });

  it("defers Neon facade instrumentation until the request creates its pool", async () => {
    workerGlobal.__env__ = {};
    const { guardNeonPool, sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const pool: Pool & {
      on: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    } = {
      id: "neon-pool",
      query: vi.fn(async () => pool.id),
      end: vi.fn(async () => {}),
      on: vi.fn(),
      connect: vi.fn(async () => undefined),
    };
    const facade = sharedDbPool("neon", "postgres://db.test/app", () => pool);

    expect(() => guardNeonPool(facade, "postgres://db.test/app")).not.toThrow();
    expect(pool.on).not.toHaveBeenCalled();

    await runWithRequestDbPoolScope(true, undefined, () => facade.query());

    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(pool.on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("keeps a request pool open through waitUntil work", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const pool: Pool = {
      id: "background-pool",
      query: vi.fn(async () => pool.id),
      end: vi.fn(async () => {}),
    };
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      () => pool,
    );
    const registered: Promise<unknown>[] = [];
    const request = {
      waitUntil(promise: Promise<unknown>) {
        registered.push(promise);
      },
    };
    let finishBackground!: () => void;
    const backgroundGate = new Promise<void>((resolve) => {
      finishBackground = resolve;
    });

    await runWithRequestDbPoolScope(true, request, async () => {
      await facade.query();
      request.waitUntil(
        (async () => {
          await backgroundGate;
          await facade.query();
        })(),
      );
    });

    expect(pool.end).not.toHaveBeenCalled();
    expect(request.waitUntil).not.toBeUndefined();
    finishBackground();
    await expect(registered[0]).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("keeps a shared initializer's owning pool alive after a sibling fails early", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { retainRequestDbPoolScope, runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const created: Pool[] = [];
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      () => {
        const pool: Pool = {
          id: `pool-${created.length + 1}`,
          query: vi.fn(async () => pool.id),
          end: vi.fn(async () => {}),
        };
        created.push(pool);
        return pool;
      },
    );
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let continueInitializer!: () => void;
    const initializerGate = new Promise<void>((resolve) => {
      continueInitializer = resolve;
    });
    let sharedInitialization: Promise<void> | undefined;
    const ensureInitialized = () => {
      sharedInitialization ??= retainRequestDbPoolScope(
        (async () => {
          await facade.query();
          markStarted();
          await initializerGate;
          await facade.query();
        })(),
      );
      return sharedInitialization;
    };

    const first = runWithRequestDbPoolScope(true, undefined, () =>
      Promise.all([
        ensureInitialized(),
        Promise.reject(new Error("sibling failed")),
      ]),
    );
    await expect(first).rejects.toThrow("sibling failed");
    await started;
    expect(created).toHaveLength(1);
    expect(created[0].end).not.toHaveBeenCalled();

    const runWaitingRequest = () =>
      runWithRequestDbPoolScope(true, undefined, async () => {
        await ensureInitialized();
        return facade.query();
      });
    const second = runWaitingRequest();
    const third = runWaitingRequest();
    continueInitializer();

    await expect(Promise.all([second, third])).resolves.toEqual([
      "pool-2",
      "pool-3",
    ]);
    expect(created.map((pool) => pool.query.mock.calls.length)).toEqual([
      2, 1, 1,
    ]);
    expect(created.map((pool) => pool.end.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("keeps response-stream database work in scope and closes after completion", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const pool: Pool = {
      id: "stream-pool",
      query: vi.fn(async () => pool.id),
      end: vi.fn(async () => {}),
    };
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      () => pool,
    );

    const response = await runWithRequestDbPoolScope(
      true,
      undefined,
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              const result = await facade.query();
              controller.enqueue(new TextEncoder().encode(result));
              controller.close();
            },
          }),
        ),
    );

    expect(pool.end).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("stream-pool");
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("closes the request pool when the response stream is cancelled", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const pool: Pool = {
      id: "cancelled-stream-pool",
      query: vi.fn(async () => pool.id),
      end: vi.fn(async () => {}),
    };
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      () => pool,
    );

    const response = await runWithRequestDbPoolScope(
      true,
      undefined,
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              const result = await facade.query();
              controller.enqueue(new TextEncoder().encode(result));
            },
          }),
        ),
    );
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    expect(pool.end).not.toHaveBeenCalled();
    await reader.cancel();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("closes pools when the handler fails", async () => {
    workerGlobal.__env__ = {};
    const { sharedDbPool } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const pool: Pool = {
      id: "error-pool",
      query: vi.fn(async () => pool.id),
      end: vi.fn(async () => {}),
    };
    const facade = sharedDbPool(
      "request-test",
      "postgres://db.test/app",
      () => pool,
    );

    await expect(
      runWithRequestDbPoolScope(true, undefined, async () => {
        await facade.query();
        throw new Error("route failed");
      }),
    ).rejects.toThrow("route failed");
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
