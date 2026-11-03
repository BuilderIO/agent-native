import { eq, sql as drizzleSql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  actionExecutionStorage,
  type ActionExecutionFrame,
} from "../action-frame.js";
import {
  defineAction,
  fail,
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "../action.js";
import {
  closeDbExec,
  getDbExec,
  getPgliteClient,
  withDbTimeout,
  type DbExec,
} from "./client.js";
import { createGetDb } from "./create-get-db.js";
import { sql } from "./sql.js";

// Real PGlite behind both `getDb()` (Drizzle) and `getDbExec()`, so each
// statement reaches the hook the way a production statement reaches a driver.
const probe = pgTable("write_observation_probe", {
  id: text("id").primaryKey(),
  note: text("note"),
});
const getDb = createGetDb({ probe });

function frame(): ActionExecutionFrame {
  return {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
  };
}

/** Whether `run` was seen to write, and through which channel. */
async function observed(run: () => Promise<unknown>) {
  const current = frame();
  if (!actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  // Awaited inside the frame: a lazy query builder runs when it is awaited.
  await actionExecutionStorage.run(
    { frame: current, failures: new WeakMap() },
    async () => {
      await run();
    },
  );
  return current.writeObserved ? (current.writeObservedChannel ?? "?") : null;
}

function inTransaction(fn: (tx: DbExec) => Promise<void>) {
  const exec = getDbExec();
  if (!exec.transaction) throw new Error("No transaction support.");
  return exec.transaction(fn);
}

async function rowIds(): Promise<string[]> {
  const { rows } = await getDbExec().execute(
    "SELECT id FROM write_observation_probe ORDER BY id",
  );
  return rows.map((row) => String(row.id));
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  await getDbExec().execute(
    "CREATE TABLE write_observation_probe (id TEXT PRIMARY KEY, note TEXT)",
  );
  await getDbExec().execute(
    "INSERT INTO write_observation_probe (id, note) VALUES ('seed', 'first')",
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("getDbExec().execute reaches the hook", () => {
  // Each row runs its own literal statement, so none is built from a variable.
  it.each([
    [
      "INSERT",
      () =>
        getDbExec().execute(
          "INSERT INTO write_observation_probe (id) VALUES ('exec-a')",
        ),
    ],
    [
      "UPDATE",
      () =>
        getDbExec().execute(
          "UPDATE write_observation_probe SET note = 'x' WHERE id = 'seed'",
        ),
    ],
    [
      "DELETE",
      () =>
        getDbExec().execute(
          "DELETE FROM write_observation_probe WHERE id = 'exec-a'",
        ),
    ],
    [
      "CREATE",
      () =>
        getDbExec().execute(
          "CREATE TABLE IF NOT EXISTS write_observation_other (id TEXT)",
        ),
    ],
  ])("sees a %s", async (_name, run) => {
    expect(await observed(run)).toBe("db");
  });

  it.each([
    [
      "SELECT",
      () => getDbExec().execute("SELECT id FROM write_observation_probe"),
    ],
    [
      "set_config",
      () =>
        getDbExec().execute(
          "SELECT set_config('statement_timeout', '0', false)",
        ),
    ],
    [
      "a locking select",
      () =>
        getDbExec().execute(
          "SELECT id FROM write_observation_probe FOR UPDATE",
        ),
    ],
    [
      "an advisory lock",
      () => getDbExec().execute("SELECT pg_advisory_xact_lock(1)"),
    ],
  ])("does not see a %s", async (_name, run) => {
    expect(await observed(run)).toBeNull();
  });

  it("reads a typed fragment and an object statement by their text", async () => {
    expect(
      await observed(() =>
        getDbExec().execute(sql`SELECT ${sql.value("x")}::text AS value`),
      ),
    ).toBeNull();
    expect(
      await observed(() =>
        getDbExec().execute({
          sql: "INSERT INTO write_observation_probe (id) VALUES (?)",
          args: ["exec-b"],
        }),
      ),
    ).toBe("db");
  });

  it("sees a write in a transaction, and not the transaction's BEGIN and COMMIT", async () => {
    expect(
      await observed(() =>
        inTransaction(async (tx) => {
          await tx.execute("SELECT 1");
        }),
      ),
    ).toBeNull();
    expect(
      await observed(() =>
        inTransaction(async (tx) => {
          await tx.execute(
            "DELETE FROM write_observation_probe WHERE id = 'exec-b'",
          );
        }),
      ),
    ).toBe("db");
  });
});

describe("getDb() (Drizzle) reaches the hook", () => {
  it("sees an insert, an update and a delete", async () => {
    const db = await getDb();
    expect(
      await observed(() => db.insert(probe).values({ id: "drizzle-a" })),
    ).toBe("db");
    expect(
      await observed(() =>
        db.update(probe).set({ note: "y" }).where(eq(probe.id, "drizzle-a")),
      ),
    ).toBe("db");
    expect(
      await observed(() => db.delete(probe).where(eq(probe.id, "drizzle-a"))),
    ).toBe("db");
  });

  it("sees a raw write and does not see a select or a raw read", async () => {
    const db = await getDb();
    expect(await observed(() => db.select().from(probe))).toBeNull();
    expect(
      await observed(() => db.execute(drizzleSql`select 1 as one`)),
    ).toBeNull();
    expect(
      await observed(() =>
        db.execute(
          drizzleSql`insert into write_observation_probe (id) values ('drizzle-raw')`,
        ),
      ),
    ).toBe("db");
  });

  it("sees a write in a transaction, and not a read-only one", async () => {
    const db = await getDb();
    expect(
      await observed(() => db.transaction((tx) => tx.select().from(probe))),
    ).toBeNull();
    expect(
      await observed(() =>
        db.transaction((tx) => tx.insert(probe).values({ id: "drizzle-tx" })),
      ),
    ).toBe("db");
  });

  it("sees a getDbExec() write inside a Drizzle transaction, and in a savepoint", async () => {
    const db = await getDb();
    expect(
      await observed(() =>
        db.transaction(async () => {
          await getDbExec().execute(
            "DELETE FROM write_observation_probe WHERE id = 'drizzle-tx'",
          );
        }),
      ),
    ).toBe("db");
    expect(
      await observed(() =>
        db.transaction(async (tx) => {
          await tx.select().from(probe);
          await tx.transaction((nested) =>
            nested.insert(probe).values({ id: "drizzle-savepoint" }),
          );
        }),
      ),
    ).toBe("db");
  });
});

describe("the PGlite client reaches the hook", () => {
  it("sees every way a statement can be sent, and the reads among them are not", async () => {
    const client = await getPgliteClient("pglite:memory");
    const write =
      "INSERT INTO write_observation_probe (id) VALUES ('client-a')";
    expect(await observed(() => client.query(write))).toBe("db");
    expect(
      await observed(() => client.exec(write.replace("client-a", "client-b"))),
    ).toBe("db");
    expect(
      await observed(
        () =>
          client.sql`INSERT INTO write_observation_probe (id) VALUES (${"client-c"})`,
      ),
    ).toBe("db");
    expect(
      await observed(() =>
        client.transaction((tx) =>
          tx.query("DELETE FROM write_observation_probe WHERE id = 'client-a'"),
        ),
      ),
    ).toBe("db");
    expect(
      await observed(() =>
        client.transaction(
          (tx) =>
            tx.sql`DELETE FROM write_observation_probe WHERE id = ${"client-b"}`,
        ),
      ),
    ).toBe("db");

    expect(await observed(() => client.query("SELECT 1"))).toBeNull();
    expect(await observed(() => client.exec("SELECT 1"))).toBeNull();
    expect(await observed(() => client.sql`SELECT ${1}::int`)).toBeNull();
    expect(
      await observed(() => client.transaction((tx) => tx.query("SELECT 1"))),
    ).toBeNull();
  });
});

describe("a statement with no text counts as a write", () => {
  it("fails closed in the timeout funnel and reads only a read's text as one", async () => {
    expect(await observed(() => withDbTimeout("query", async () => []))).toBe(
      "db",
    );
    expect(
      await observed(() =>
        withDbTimeout("query", async () => [], 100, undefined, {
          sql: "SELECT 1",
        }),
      ),
    ).toBeNull();
    expect(
      await observed(() => withDbTimeout("connect", async () => undefined)),
    ).toBeNull();
  });
});

describe("a failed action over a real database", () => {
  const tool: ActionRunContext = {
    caller: "tool",
    actionName: "write-observation-probe",
    userEmail: "agent@example.com",
  };

  async function run(action: ReturnType<typeof defineAction>) {
    const outcome: ActionExecutionOutcome = { refused: false };
    const error = await runActionWithExecutionOutcome(
      action.run,
      {},
      tool,
      outcome,
      action,
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeDefined();
    return invocationEffect(action, outcome, { failed: { error } });
  }

  const createFile = (
    via: "drizzle" | "exec",
    id: string,
    rejectFirst: boolean,
  ) =>
    defineAction({
      description: "Create a file, rejecting a bad one.",
      schema: z.object({}),
      run: async () => {
        if (rejectFirst) fail("The file must not contain a meta tag.");
        if (via === "drizzle") {
          await (await getDb()).insert(probe).values({ id });
        } else {
          await getDbExec().execute({
            sql: "INSERT INTO write_observation_probe (id) VALUES (?)",
            args: [id],
          });
        }
        fail("The file could not be linked.");
      },
    });

  it.each(["drizzle", "exec"] as const)(
    "is unknown when it wrote through %s and then failed, and the row is there",
    async (via) => {
      const id = `saved-${via}`;
      expect(await run(createFile(via, id, false))).toEqual({
        effect: "unknown",
        changed: true,
      });
      expect(await rowIds()).toContain(id);
    },
  );

  it.each(["drizzle", "exec"] as const)(
    "is none when it was rejected before saving, and nothing is there (%s)",
    async (via) => {
      const id = `rejected-${via}`;
      expect(await run(createFile(via, id, true))).toEqual({
        effect: "none",
        changed: true,
      });
      expect(await rowIds()).not.toContain(id);
    },
  );

  it("is none after reading first, and its own audit row does not count as a write", async () => {
    const rejectedAfterReading = defineAction({
      description: "Look first, then reject.",
      schema: z.object({}),
      run: async () => {
        await (await getDb()).select().from(probe);
        await getDbExec().execute(
          "SELECT count(*) FROM write_observation_probe",
        );
        fail("Rejected after reading.");
      },
    });
    expect(await run(rejectedAfterReading)).toEqual({
      effect: "none",
      changed: true,
    });
    const { rows } = await getDbExec().execute({
      sql: "SELECT status FROM agent_audit_log WHERE action = ?",
      args: ["write-observation-probe"],
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("is unknown when a nested action wrote and the parent then failed", async () => {
    const child = createFile("drizzle", "saved-child", false);
    const parent = defineAction({
      description: "Run the child, then fail.",
      schema: z.object({}),
      run: async (_args, ctx) => {
        await child.run({}, ctx).catch(() => undefined);
        fail("Failed after the child.");
      },
    });
    expect((await run(parent)).effect).toBe("unknown");
    expect(await rowIds()).toContain("saved-child");
  });

  it("is none when the nested action entered and was rejected before writing", async () => {
    const child = createFile("drizzle", "never-child", true);
    const parent = defineAction({
      description: "Run the child.",
      schema: z.object({}),
      run: async (_args, ctx) => child.run({}, ctx),
    });
    expect((await run(parent)).effect).toBe("none");
    expect(await rowIds()).not.toContain("never-child");
  });
});
