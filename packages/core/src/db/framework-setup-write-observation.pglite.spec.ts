import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  defineAction,
  fail,
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "../action.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { appStateGet } from "../application-state/store.js";
import { getSetting } from "../settings/store.js";
import { closeDbExec, getDbExec } from "./client.js";
import {
  ensureColumnExists,
  ensureIndexExistsConcurrently,
  ensureTableExists,
} from "./ddl-guard.js";
import { defineStore } from "./store-registry.js";
import { fromMigrationEntries } from "./versioned-store-migrations.js";

// Each case starts on a database no framework store has touched, so the first
// action to read one runs that store's schema setup inside its own call.
const tool: ActionRunContext = {
  caller: "tool",
  actionName: "framework-setup-probe",
  userEmail: "agent@example.com",
};

async function exists(relation: string): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT to_regclass(?) IS NOT NULL AS present",
    args: [relation],
  });
  return rows[0]?.present === true || rows[0]?.present === "t";
}

/** What a failed action reads as when `run` happens before its rejection. */
async function effectOf(run: () => Promise<unknown>) {
  const action = defineAction({
    description: "Run the probe, then reject.",
    schema: z.object({}),
    run: async () => {
      await run();
      fail("Rejected after the probe.");
    },
  });
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
  return invocationEffect(action, outcome, { failed: { error } }).effect;
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  await closeDbExec();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("framework schema setup inside a failed action", () => {
  it("is none when the first read of a framework store created its tables", async () => {
    expect(await effectOf(() => getSetting("probe"))).toBe("none");
    expect(await exists("settings")).toBe(true);
  });

  it("is none when the first read was application state", async () => {
    expect(await effectOf(() => appStateGet("probe"))).toBe("none");
    expect(await exists("application_state")).toBe(true);
  });

  it("is none after reading two stores that were both missing", async () => {
    expect(
      await effectOf(async () => {
        await getSetting("probe");
        await appStateGet("probe");
      }),
    ).toBe("none");
  });

  it("is unknown when the action then writes its own row", async () => {
    expect(
      await effectOf(async () => {
        await getSetting("probe");
        await getDbExec().execute("CREATE TABLE probe_rows (id TEXT)");
        await getDbExec().execute("INSERT INTO probe_rows (id) VALUES ('a')");
      }),
    ).toBe("unknown");
  });

  it("is unknown when the action writes before it reads a missing store", async () => {
    expect(
      await effectOf(async () => {
        await getDbExec().execute("CREATE TABLE probe_first (id TEXT)");
        await getSetting("probe");
      }),
    ).toBe("unknown");
  });
});

describe("ddl-guard helpers inside a failed action", () => {
  it("is none when a table, column and index were ensured", async () => {
    expect(
      await effectOf(async () => {
        await ensureTableExists(
          "ensured_table",
          "CREATE TABLE IF NOT EXISTS ensured_table (id TEXT PRIMARY KEY)",
        );
        await ensureColumnExists(
          "ensured_table",
          "note",
          "ALTER TABLE ensured_table ADD COLUMN IF NOT EXISTS note TEXT",
        );
        await ensureIndexExistsConcurrently(
          "ensured_table_note_idx",
          "CREATE INDEX CONCURRENTLY IF NOT EXISTS ensured_table_note_idx ON ensured_table (note)",
        );
      }),
    ).toBe("none");
    expect(await exists("ensured_table")).toBe(true);
    expect(await exists("ensured_table_note_idx")).toBe(true);
  });

  it("is none when an invalid index left by a failed build is dropped and rebuilt", async () => {
    const exec = getDbExec();
    await exec.execute("CREATE TABLE rebuilt_table (note TEXT)");
    await exec.execute("INSERT INTO rebuilt_table (note) VALUES ('a'), ('a')");
    await exec
      .execute(
        "CREATE UNIQUE INDEX CONCURRENTLY rebuilt_table_note_idx ON rebuilt_table (note)",
      )
      .then(
        () => {
          throw new Error("The duplicate rows should have failed the build.");
        },
        () => undefined,
      );
    expect(
      await effectOf(() =>
        ensureIndexExistsConcurrently(
          "rebuilt_table_note_idx",
          "CREATE INDEX CONCURRENTLY IF NOT EXISTS rebuilt_table_note_idx ON rebuilt_table (note)",
        ),
      ),
    ).toBe("none");
    const { rows } = await exec.execute({
      sql: "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(?)",
      args: ["rebuilt_table_note_idx"],
    });
    expect(rows[0]?.indisvalid).toBe(true);
  });

  it("is unknown when a row is inserted after the table was ensured", async () => {
    expect(
      await effectOf(async () => {
        await ensureTableExists(
          "ensured_then_inserted",
          "CREATE TABLE IF NOT EXISTS ensured_then_inserted (id TEXT PRIMARY KEY)",
        );
        await getDbExec().execute(
          "INSERT INTO ensured_then_inserted (id) VALUES ('a')",
        );
      }),
    ).toBe("unknown");
  });
});

describe("a store's own migrations inside a failed action", () => {
  it("is none when the store only creates schema", async () => {
    const store = defineStore({
      id: "schema_only",
      migrations: [
        {
          name: "baseline",
          sql: "CREATE TABLE IF NOT EXISTS schema_only (id TEXT PRIMARY KEY)",
        },
        {
          name: "add-note",
          run: async (exec) => {
            await exec.execute(
              "ALTER TABLE schema_only ADD COLUMN IF NOT EXISTS note TEXT",
            );
          },
        },
      ],
    });
    expect(await effectOf(() => store.ready())).toBe("none");
    expect(await exists("schema_only")).toBe(true);
  });

  it("is unknown when a data migration writes rows during the call", async () => {
    const store = defineStore({
      id: "with_backfill",
      migrations: [
        {
          name: "baseline",
          sql: "CREATE TABLE IF NOT EXISTS with_backfill (id TEXT PRIMARY KEY)",
        },
        {
          name: "seed",
          kind: "data",
          sql: "INSERT INTO with_backfill (id) VALUES ('seeded') ON CONFLICT DO NOTHING",
        },
      ],
    });
    expect(await effectOf(() => store.ready())).toBe("unknown");
    const { rows } = await getDbExec().execute("SELECT id FROM with_backfill");
    expect(rows.map((row) => row.id)).toEqual(["seeded"]);
  });

  it("is none when an entry carried over from a boot-time list is applied", async () => {
    const store = defineStore({
      id: "boot_list",
      migrations: fromMigrationEntries(
        "_boot_list_migrations",
        [
          {
            version: 1,
            sql: "CREATE TABLE IF NOT EXISTS boot_list (id TEXT PRIMARY KEY)",
          },
        ],
        { ranAtBoot: true },
      ),
    });
    expect(await effectOf(() => store.ready())).toBe("none");
    const { rows } = await getDbExec().execute(
      "SELECT version FROM _boot_list_migrations",
    );
    expect(rows.map((row) => Number(row.version))).toEqual([1]);
  });

  it("is none when a hosted request without release migrations replays the schema", async () => {
    const store = defineStore({
      id: "hosted_replay",
      migrations: [
        {
          name: "baseline",
          sql: "CREATE TABLE IF NOT EXISTS hosted_replay (id TEXT PRIMARY KEY)",
        },
      ],
    });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    resetAppConfigForTests();
    expect(await effectOf(() => store.ready())).toBe("none");
    expect(await exists("hosted_replay")).toBe(true);
  });
});
