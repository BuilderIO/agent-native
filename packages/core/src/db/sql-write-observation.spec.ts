import { pgTable, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test loads its own copy of the modules, so the frame storage the hook
// writes to is the one the test reads. Statements go to fake drivers, so what
// is asserted is what reaches them and whether it was seen first.
const probe = pgTable("write_observation_probe", {
  id: text("id").primaryKey(),
});

async function load() {
  vi.resetModules();
  const [frames, client, getDb] = await Promise.all([
    import("../action-frame.js"),
    import("./client.js"),
    import("./create-get-db.js"),
  ]);
  return { ...frames, ...client, ...getDb };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Whether `run` was seen to write, and through which channel. */
async function observed(loaded: Loaded, run: () => Promise<unknown>) {
  const frame: import("../action-frame.js").ActionExecutionFrame = {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
  };
  if (!loaded.actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  await loaded.actionExecutionStorage.run(
    { frame, failures: new WeakMap() },
    async () => {
      await run();
    },
  );
  return frame.writeObserved ? (frame.writeObservedChannel ?? "?") : null;
}

const INSERT = "INSERT INTO write_observation_probe (id) VALUES ('a')";
const SELECT = "SELECT id FROM write_observation_probe";

afterEach(async () => {
  vi.doUnmock("@electric-sql/pglite");
  vi.doUnmock("@neondatabase/serverless");
  vi.doUnmock("postgres");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(
    globalThis as Record<string, unknown>,
    "__AGENT_NATIVE_BACKGROUND_RUNTIME__",
  );
});

/** A postgres.js query: awaitable, with `.values()` for array rows. */
const fakeQuery = (rows: unknown[] = []) =>
  Object.assign(Promise.resolve(Object.assign([...rows], { count: 0 })), {
    values: () => Promise.resolve(rows),
    cancel: () => undefined,
  });

describe("a PGlite call that carries no statement text", () => {
  it("counts as a write, while a read call and an exclusive section do not", async () => {
    // raw-sql-ok: a PGlite client double; `sql` is the driver's tagged-template method here, not a statement.
    const fake = {
      query: vi.fn(async () => ({ rows: [] })),
      sql: vi.fn(async () => ({ rows: [] })),
      execProtocolRaw: vi.fn(async () => new Uint8Array()),
      execProtocol: vi.fn(async () => ({
        messages: [],
        data: new Uint8Array(),
      })),
      runExclusive: vi.fn(async (fn: () => Promise<unknown>) => fn()),
      close: vi.fn(async () => {}),
    };
    vi.doMock("@electric-sql/pglite", () => ({
      PGlite: { create: vi.fn(async () => fake) },
    }));
    const loaded = await load();
    const client = await loaded.getPgliteClient("pglite:memory");

    expect(
      await observed(loaded, () => client.execProtocolRaw(new Uint8Array())),
    ).toBe("db");
    expect(
      await observed(loaded, () => client.execProtocol(new Uint8Array())),
    ).toBe("db");
    expect(
      await observed(loaded, () => client.sql("not a template literal")),
    ).toBe("db");
    expect(
      await observed(loaded, () => client.query({ text: "SELECT 1" })),
    ).toBe("db");
    expect(await observed(loaded, () => client.query(SELECT))).toBeNull();
    expect(
      await observed(loaded, () => client.runExclusive(async () => undefined)),
    ).toBeNull();
    await loaded.closeDbExec();
  });
});

describe("Neon through getDbExec()", () => {
  function neonPool() {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    };
    vi.doMock("@neondatabase/serverless", () => ({
      Pool: vi.fn(function MockPool() {
        return pool;
      }),
      neon: vi.fn(),
      neonConfig: {},
    }));
    return client;
  }
  const url = "postgresql://user:pass@ep-test.us-east-1.aws.neon.tech/db";

  it("sees a write and not a read, with and without a statement budget", async () => {
    const client = neonPool();
    const loaded = await load();
    const exec = await loaded.createDbExec({ url });

    expect(await observed(loaded, () => exec.execute(INSERT))).toBe("db");
    expect(await observed(loaded, () => exec.execute(SELECT))).toBeNull();
    expect(
      await observed(loaded, () =>
        exec.execute({ sql: INSERT, timeoutMs: 4_000, maxAttempts: 1 }),
      ),
    ).toBe("db");
    expect(
      await observed(loaded, () =>
        exec.execute({ sql: SELECT, timeoutMs: 4_000, maxAttempts: 1 }),
      ),
    ).toBeNull();
    expect(client.query).toHaveBeenCalledWith(INSERT, []);
  });

  it("sees a write in a transaction, and not the transaction's own statements", async () => {
    const client = neonPool();
    const loaded = await load();
    const exec = await loaded.createDbExec({ url });
    const transaction = exec.transaction?.bind(exec);
    if (!transaction) throw new Error("No transaction support.");

    expect(
      await observed(loaded, () =>
        transaction(async (tx) => {
          await tx.execute(SELECT);
        }),
      ),
    ).toBeNull();
    expect(
      await observed(loaded, () =>
        transaction(async (tx) => {
          await tx.execute(INSERT);
        }),
      ),
    ).toBe("db");
    const sent = client.query.mock.calls.map(([text]) => String(text));
    expect(sent).toContain(
      "BEGIN; SET LOCAL idle_in_transaction_session_timeout = 30000",
    );
    expect(sent).toContain("COMMIT");
  });

  it("sees a write sent over Neon HTTP from a background function", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    // The only mock of this module in this test: Vitest resolves queued
    // doMock calls in parallel, so a second mock of the same module before the
    // next import does not reliably replace the first.
    vi.doMock("@neondatabase/serverless", () => ({
      Pool: vi.fn(function MockPool() {
        return { end: vi.fn(async () => {}), on: vi.fn() };
      }),
      neon: vi.fn(() => ({
        query,
        transaction: vi.fn(async () => [{}, { rows: [], rowCount: 0 }]),
      })),
      neonConfig: {},
    }));
    vi.stubGlobal("__AGENT_NATIVE_BACKGROUND_RUNTIME__", true);
    const loaded = await load();
    const exec = await loaded.createDbExec({ url });

    expect(await observed(loaded, () => exec.execute(INSERT))).toBe("db");
    expect(await observed(loaded, () => exec.execute(SELECT))).toBeNull();
    expect(
      await observed(loaded, () =>
        exec.execute({ sql: INSERT, timeoutMs: 4_000, maxAttempts: 1 }),
      ),
    ).toBe("db");
    expect(query.mock.calls.map(([text]) => String(text))).toContain(INSERT);
  });
});

describe("postgres.js through getDbExec()", () => {
  const url = "postgres://db.test/app";

  function fakePostgres() {
    const tx = { unsafe: vi.fn(() => fakeQuery()) };
    const pool = Object.assign(() => undefined, {
      unsafe: vi.fn(() => fakeQuery()),
      begin: vi.fn(async (run: (sql: typeof tx) => unknown) => run(tx)),
      end: vi.fn(async () => {}),
    });
    vi.doMock("postgres", () => ({ default: vi.fn(() => pool) }));
    return { pool, tx };
  }

  it("sees a write and not a read, outside and inside a transaction", async () => {
    vi.stubEnv("DATABASE_URL", url);
    const { pool, tx } = fakePostgres();
    const loaded = await load();
    const exec = await loaded.createDbExec({ url });
    const transaction = exec.transaction?.bind(exec);
    if (!transaction) throw new Error("No transaction support.");

    expect(await observed(loaded, () => exec.execute(INSERT))).toBe("db");
    expect(await observed(loaded, () => exec.execute(SELECT))).toBeNull();
    expect(
      await observed(loaded, () =>
        transaction(async (inner) => {
          await inner.execute(SELECT);
        }),
      ),
    ).toBeNull();
    expect(
      await observed(loaded, () =>
        transaction(async (inner) => {
          await inner.execute(INSERT);
        }),
      ),
    ).toBe("db");
    expect(pool.unsafe).toHaveBeenCalledTimes(2);
    expect(tx.unsafe).toHaveBeenCalledTimes(2);
  });

  it("sees a write sent from a Worker, outside and inside a transaction", async () => {
    vi.stubGlobal("__cf_env", {});
    const worker = {
      unsafe: vi.fn(() => fakeQuery()),
      end: vi.fn(async () => {}),
    };
    const tx = { unsafe: vi.fn(() => fakeQuery()) };
    vi.doMock("postgres", () => ({
      default: vi.fn(() => ({
        ...worker,
        begin: async (run: (sql: typeof tx) => unknown) => run(tx),
      })),
    }));
    const loaded = await load();
    const exec = await loaded.createDbExec({ url });
    const transaction = exec.transaction?.bind(exec);
    if (!transaction) throw new Error("No transaction support.");

    expect(await observed(loaded, () => exec.execute(INSERT))).toBe("db");
    expect(await observed(loaded, () => exec.execute(SELECT))).toBeNull();
    expect(
      await observed(loaded, () =>
        transaction(async (inner) => {
          await inner.execute(INSERT);
        }),
      ),
    ).toBe("db");
    expect(tx.unsafe).toHaveBeenCalledTimes(1);
  });
});

describe("Drizzle over postgres.js through getDb()", () => {
  it("sees a write the driver is handed raw inside a transaction, and no read", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db.test/app");
    const tx = { unsafe: vi.fn(() => fakeQuery()) };
    const client = Object.assign(() => undefined, {
      options: { parsers: {}, serializers: {} },
      unsafe: vi.fn(() => fakeQuery()),
      begin: vi.fn(async (run: (sql: typeof tx) => unknown) => run(tx)),
      end: vi.fn(async () => {}),
    });
    vi.doMock("postgres", () => ({ default: vi.fn(() => client) }));
    const loaded = await load();
    const db = await loaded.createGetDb({ probe })();

    expect(
      await observed(loaded, () => db.insert(probe).values({ id: "a" })),
    ).toBe("db");
    expect(await observed(loaded, () => db.select().from(probe))).toBeNull();
    expect(
      await observed(loaded, () =>
        db.transaction((inner) => inner.select().from(probe)),
      ),
    ).toBeNull();
    tx.unsafe.mockClear();
    expect(
      await observed(loaded, () =>
        db.transaction((inner) => inner.insert(probe).values({ id: "b" })),
      ),
    ).toBe("db");
    // The driver was handed the statement raw, outside every pool wrapper.
    expect(tx.unsafe.mock.calls.map(([text]) => String(text))).toContainEqual(
      expect.stringContaining('insert into "write_observation_probe"'),
    );
  });
});

describe("Drizzle over Neon through getDb()", () => {
  it("sees a write sent over the pool and over a transaction's own connection", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://user:pass@ep-test.us-east-1.aws.neon.tech/db",
    );
    const { Pool } = await import("@neondatabase/serverless");
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
      on: vi.fn(),
    };
    vi.spyOn(Pool.prototype, "connect").mockImplementation(
      (async () => client) as never,
    );
    const loaded = await load();
    const db = await loaded.createGetDb({ probe })();

    expect(
      await observed(loaded, () => db.insert(probe).values({ id: "a" })),
    ).toBe("db");
    expect(await observed(loaded, () => db.select().from(probe))).toBeNull();
    expect(
      await observed(loaded, () =>
        db.transaction((tx) => tx.select().from(probe)),
      ),
    ).toBeNull();
    client.query.mockClear();
    expect(
      await observed(loaded, () =>
        db.transaction((tx) => tx.insert(probe).values({ id: "b" })),
      ),
    ).toBe("db");
    expect(
      client.query.mock.calls.map(([config]) =>
        String((config as { text?: string }).text ?? config),
      ),
    ).toContainEqual(
      expect.stringContaining('insert into "write_observation_probe"'),
    );
  });
});

describe("a pooled driver client built by the framework", () => {
  it("counts a Neon pool query by its text, and one with no text as a write", async () => {
    const loaded = await load();
    const raw = {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({ rows: [] })),
        release: vi.fn(),
      })),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    const pool = loaded.buildResilientNeonPool(raw);

    expect(await observed(loaded, () => pool.query(INSERT))).toBe("db");
    expect(await observed(loaded, () => pool.query({ text: INSERT }))).toBe(
      "db",
    );
    expect(await observed(loaded, () => pool.query(SELECT))).toBeNull();
    expect(
      await observed(loaded, () => pool.query({ text: SELECT })),
    ).toBeNull();
    expect(await observed(loaded, () => pool.query({ name: "unnamed" }))).toBe(
      "db",
    );
  });

  it("counts a postgres.js unsafe query by its text", async () => {
    const loaded = await load();
    const client = loaded.buildResilientPostgresJsClient({
      unsafe: vi.fn(() => fakeQuery()),
    });

    expect(await observed(loaded, async () => client.unsafe(INSERT))).toBe(
      "db",
    );
    expect(
      await observed(loaded, async () => client.unsafe(SELECT)),
    ).toBeNull();
  });
});
