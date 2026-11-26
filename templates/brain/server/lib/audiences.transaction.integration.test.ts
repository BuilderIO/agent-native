import { AsyncLocalStorage } from "node:async_hooks";

import { PGlite } from "@electric-sql/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

type Db = ReturnType<typeof getDb>;
const state = vi.hoisted(() => ({
  db: undefined as Db | undefined,
  scope: undefined as AsyncLocalStorage<Db> | undefined,
  transactions: 0,
  nestedAttempts: 0,
}));
vi.mock("../db/index.js", async () => ({
  schema: await import("../db/schema.js"),
  getDb: () => {
    if (!state.db) throw new Error("Test database is not ready");
    return state.db;
  },
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getEnclosingTransactionDbExec: () =>
    state.scope?.getStore()
      ? {
          execute: async () => {
            throw new Error("Unexpected executor call");
          },
        }
      : undefined,
}));

import { ensureCaptureAudience } from "./audiences.js";

const client = new PGlite();
const database = drizzle(client, { schema });
const quoted = (value: string) => `"${value.split('"').join('""')}"`;

beforeAll(async () => {
  const dialect = new PgDialect();
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `${quoted(column.name)} ${column.getSQLType()}`;
      if (column.primary) definition += " PRIMARY KEY";
      if (column.notNull) definition += " NOT NULL";
      if (column.default !== undefined) {
        const value = column.default;
        const expression =
          value instanceof SQL
            ? dialect.sqlToQuery(value).sql
            : typeof value === "number"
              ? String(value)
              : `'${String(value).split("'").join("''")}'`;
        definition += ` DEFAULT ${expression}`;
      }
      return definition;
    });
    await client.exec(
      `CREATE TABLE ${quoted(config.name)} (${columns.join(", ")})`,
    );
  }
  await client.exec(
    "CREATE UNIQUE INDEX audience_member_identity ON brain_audience_members (audience_id, principal_type, principal_id); CREATE UNIQUE INDEX capture_audience_identity ON brain_capture_audiences (capture_id, audience_id)",
  );
});
afterAll(async () => client.close());
beforeEach(async () => {
  for (const table of Object.values(schema)) await database.delete(table);
  state.scope = new AsyncLocalStorage<Db>();
  state.transactions = 0;
  state.nestedAttempts = 0;
  state.db = new Proxy(database, {
    get(target, property) {
      if (property === "transaction") {
        return async (callback: (tx: Db) => Promise<unknown>) => {
          if (state.scope?.getStore()) {
            state.nestedAttempts += 1;
            throw new Error("Cannot start a nested root transaction");
          }
          state.transactions += 1;
          return target.transaction(async (tx) => {
            const scope = state.scope;
            if (!scope) throw new Error("Missing transaction scope");
            const scoped = tx as unknown as Db;
            return scope.run(scoped, () => callback(scoped));
          });
        };
      }
      const active = state.scope?.getStore() ?? target;
      const value = Reflect.get(active, property, active);
      return typeof value === "function" ? value.bind(active) : value;
    },
  }) as unknown as Db;
  await database.insert(schema.brainSources).values({
    id: "source",
    title: "Private source",
    provider: "google_drive",
    ownerEmail: "qa-fleet@builder.io",
    visibility: "private",
  });
});

async function assignment() {
  const source = (await rootDb().select().from(schema.brainSources)).find(
    (row) => row.id === "source",
  );
  if (!source) throw new Error("Missing source fixture");
  return ensureCaptureAudience({
    captureId: "capture",
    source,
    kind: "restricted",
  });
}

function rootDb() {
  if (!state.db) throw new Error("Missing database facade");
  return state.db;
}

describe("capture audiences inside production-style root transactions", () => {
  it("keeps standalone audience writes atomic", async () => {
    const result = await assignment();
    expect(await database.select().from(schema.brainAudiences)).toEqual([
      expect.objectContaining({
        id: result.audienceId,
        membershipState: "current",
      }),
    ]);
    expect(
      await database.select().from(schema.brainCaptureAudiences),
    ).toHaveLength(1);
    expect(state.transactions).toBe(1);
    expect(state.nestedAttempts).toBe(0);
  });

  it("reuses the enclosing session instead of opening a nested root transaction", async () => {
    await rootDb().transaction(async () => {
      await assignment();
    });
    expect(await database.select().from(schema.brainAudiences)).toHaveLength(1);
    expect(
      await database.select().from(schema.brainAudienceMembers),
    ).toHaveLength(1);
    expect(state.transactions).toBe(1);
    expect(state.nestedAttempts).toBe(0);
  });

  it("rolls audience, membership and capture links back with their enclosing transaction", async () => {
    await expect(
      rootDb().transaction(async () => {
        await assignment();
        expect(
          await rootDb().select().from(schema.brainAudiences),
        ).toHaveLength(1);
        expect(
          await rootDb().select().from(schema.brainCaptureAudiences),
        ).toHaveLength(1);
        throw new Error("Rollback fixture");
      }),
    ).rejects.toThrow("Rollback fixture");
    expect(await database.select().from(schema.brainAudiences)).toEqual([]);
    expect(await database.select().from(schema.brainAudienceMembers)).toEqual(
      [],
    );
    expect(await database.select().from(schema.brainCaptureAudiences)).toEqual(
      [],
    );
    expect(state.transactions).toBe(1);
    expect(state.nestedAttempts).toBe(0);
  });
});
