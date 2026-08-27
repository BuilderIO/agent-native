/**
 * Real-SQL coverage for the "at most one default design system per owner and
 * org" invariant. Both writers used to read the scope and then insert with
 * `isDefault` derived from that read, so concurrent creates each claimed the
 * default and the list rendered several Default badges. A mocked Drizzle chain
 * cannot show that, because it never interleaves two transactions on one
 * connection.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  sqlite: null as null | {
    inTransaction: boolean;
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): unknown;
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  },
}));

const identity = vi.hoisted(() => ({
  email: "designer@example.com" as string | null,
  orgId: "org_example" as string | null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => identity.email,
  getRequestOrgId: () => identity.orgId,
}));

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...original,
    // Route DDL through the same in-memory connection `getDb()` uses below,
    // instead of whatever real database the test environment happens to
    // resolve — this is what lets the unique-index tests observe a real
    // SQLITE_CONSTRAINT_UNIQUE instead of a silently-swallowed no-op against
    // an unrelated connection.
    getDbExec: () => ({
      execute: async (
        statement: string | { sql: string; args?: unknown[] },
      ) => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        const args =
          typeof statement === "string" ? [] : (statement.args ?? []);
        if (!localDb.sqlite) throw new Error("sqlite not initialized");
        const result = localDb.sqlite.prepare(sql).run(...args);
        return {
          rows: [],
          rowsAffected: (result as { changes: number }).changes,
        };
      },
    }),
  };
});

vi.mock("../db/index.js", async () => {
  const [{ createRequire }, { drizzle }, sqliteCore, coreDb] =
    await Promise.all([
      import("node:module"),
      import("drizzle-orm/better-sqlite3"),
      import("drizzle-orm/sqlite-core"),
      import("@agent-native/core/testing"),
    ]);

  const designSystems = sqliteCore.sqliteTable("design_systems", {
    id: sqliteCore.text("id").primaryKey(),
    title: sqliteCore.text("title").notNull(),
    description: sqliteCore.text("description"),
    data: sqliteCore.text("data").notNull(),
    assets: sqliteCore.text("assets"),
    customInstructions: sqliteCore
      .text("custom_instructions")
      .notNull()
      .default(""),
    isDefault: sqliteCore
      .integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    ownerEmail: sqliteCore.text("owner_email"),
    orgId: sqliteCore.text("org_id"),
    visibility: sqliteCore.text("visibility"),
    createdAt: sqliteCore.text("created_at"),
    updatedAt: sqliteCore.text("updated_at"),
  });

  const requireFromCore = createRequire(
    new URL("../../../../packages/core/package.json", import.meta.url),
  );
  const Database = requireFromCore("better-sqlite3") as new (
    filename: string,
  ) => NonNullable<typeof localDb.sqlite>;
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE design_systems (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      data TEXT NOT NULL,
      assets TEXT,
      custom_instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT,
      org_id TEXT,
      visibility TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  const rawDb = drizzle(sqlite as never, {
    schema: { designSystems },
  }) as unknown as ReturnType<typeof drizzle> & { session: unknown };
  const db = coreDb.patchBetterSqliteTransactions(rawDb, sqlite);
  localDb.sqlite = sqlite;
  return {
    getDb: () => db,
    schema: { designSystems, designSystemShares: {} },
  };
});

import createDesignSystemAction from "../../actions/create-design-system.js";
import { upsertBuilderProxyDesignSystem } from "./builder-design-system-proxy.js";
import {
  createDesignSystemsOneDefaultIndex,
  healDuplicateDesignSystemDefaults,
} from "./design-system-defaults.js";

const OWNER = "designer@example.com";
const ORG = "org_example";

function seed({
  id,
  ownerEmail = OWNER,
  orgId = ORG as string | null,
  isDefault,
  createdAt,
}: {
  id: string;
  ownerEmail?: string;
  orgId?: string | null;
  isDefault: boolean;
  createdAt: string;
}) {
  localDb.sqlite
    // guard:allow-unscoped — test fixture seeding rows the action under test reads back
    ?.prepare(
      `INSERT INTO design_systems
       (id, title, data, is_default, owner_email, org_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      id,
      "{}",
      isDefault ? 1 : 0,
      ownerEmail,
      orgId,
      orgId ? "org" : "private",
      createdAt,
      createdAt,
    );
}

function defaultsFor(ownerEmail: string, orgId: string | null): string[] {
  // guard:allow-unscoped — assertion reads every row on purpose, to prove the
  // writers scoped their own default claim
  const rows = localDb.sqlite
    ?.prepare(
      "SELECT id, is_default, owner_email, org_id FROM design_systems ORDER BY created_at ASC, rowid ASC",
    )
    .all() as Array<{
    id: string;
    is_default: number;
    owner_email: string;
    org_id: string | null;
  }>;
  return (rows ?? [])
    .filter(
      (row) =>
        row.is_default === 1 &&
        row.owner_email === ownerEmail &&
        (row.org_id ?? null) === orgId,
    )
    .map((row) => row.id);
}

function create(title: string) {
  return createDesignSystemAction.run({
    title,
    data: JSON.stringify({ colors: { primary: "#123456" } }),
  } as never);
}

function upsertProxy(designSystemId: string) {
  return upsertBuilderProxyDesignSystem({
    result: {
      ok: true,
      source: "builder",
      projectId: "project_1",
      jobId: `job_${designSystemId}`,
      designSystemId,
      suggestedTitle: null,
      builderUrl: `https://builder.io/ds/${designSystemId}`,
      status: "in-progress",
    },
    ownerEmail: OWNER,
    orgId: ORG,
    projectName: `Builder ${designSystemId}`,
  });
}

beforeEach(() => {
  identity.email = OWNER;
  identity.orgId = ORG;
  // guard:allow-unscoped — fixture reset of an in-memory table owned by this
  // spec; there is no request identity to scope to. The index is dropped too
  // so each test starts from the pre-migration state and opts into the real
  // constraint explicitly, since once installed it rejects the very
  // duplicate-seeding some tests need to set up a pre-existing-corruption
  // scenario.
  localDb.sqlite?.exec(`
    DROP INDEX IF EXISTS design_systems_one_default_per_scope_idx;
    DELETE FROM design_systems;
  `);
});

afterAll(() => {
  localDb.sqlite?.close();
});

describe("design system default claim with real SQLite", () => {
  it("leaves exactly one default when several creates race, and never touches another owner's default", async () => {
    seed({
      id: "teammate_default",
      ownerEmail: "teammate@example.com",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const results = await Promise.all([
      create("Alpha"),
      create("Beta"),
      create("Gamma"),
    ]);

    expect(defaultsFor(OWNER, ORG)).toHaveLength(1);
    expect(results.filter((result) => result.isDefault)).toHaveLength(1);
    expect(defaultsFor("teammate@example.com", ORG)).toEqual([
      "teammate_default",
    ]);
  });

  it("heals a scope an earlier race already left with duplicate defaults", async () => {
    seed({
      id: "older_default",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    seed({
      id: "racing_default",
      isDefault: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const next = await create("Next");

    expect(next.isDefault).toBe(false);
    expect(defaultsFor(OWNER, ORG)).toEqual(["older_default"]);
  });
});

describe("healDuplicateDesignSystemDefaults", () => {
  it("keeps only the earliest default per owner/org scope, across multiple scopes at once", async () => {
    seed({
      id: "mine_older",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    seed({
      id: "mine_newer",
      isDefault: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    seed({
      id: "teammate_older",
      ownerEmail: "teammate@example.com",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    seed({
      id: "teammate_newer",
      ownerEmail: "teammate@example.com",
      isDefault: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    seed({
      id: "single_default",
      orgId: "org_other",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const healedCount = await healDuplicateDesignSystemDefaults();

    expect(healedCount).toBe(2);
    expect(defaultsFor(OWNER, ORG)).toEqual(["mine_older"]);
    expect(defaultsFor("teammate@example.com", ORG)).toEqual([
      "teammate_older",
    ]);
    expect(defaultsFor(OWNER, "org_other")).toEqual(["single_default"]);
  });

  it("is a no-op when no scope has duplicates", async () => {
    seed({
      id: "only_default",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await healDuplicateDesignSystemDefaults()).toBe(0);
    expect(defaultsFor(OWNER, ORG)).toEqual(["only_default"]);
  });
});

describe("createDesignSystemsOneDefaultIndex against a real connection", () => {
  it("makes a second default in the same scope a real constraint violation", async () => {
    await createDesignSystemsOneDefaultIndex();
    seed({
      id: "first_default",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(() =>
      // guard:allow-unscoped — asserting the installed index rejects a raw
      // insert that bypasses the app-level claim logic entirely
      localDb.sqlite
        ?.prepare(
          `INSERT INTO design_systems (id, title, data, is_default, owner_email, org_id, visibility, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          "second_default",
          "second_default",
          "{}",
          OWNER,
          ORG,
          "org",
          "2026-01-02T00:00:00.000Z",
          "2026-01-02T00:00:00.000Z",
        ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("survives being created twice (IF NOT EXISTS)", async () => {
    await createDesignSystemsOneDefaultIndex();
    await expect(createDesignSystemsOneDefaultIndex()).resolves.toBeUndefined();
  });
});

describe("full release path: heal then create the index, then race real creates against it", () => {
  it("still leaves exactly one default once the constraint is actually installed", async () => {
    seed({
      id: "pre_fix_duplicate_a",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    seed({
      id: "pre_fix_duplicate_b",
      isDefault: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    await healDuplicateDesignSystemDefaults();
    await createDesignSystemsOneDefaultIndex();

    expect(defaultsFor(OWNER, ORG)).toEqual(["pre_fix_duplicate_a"]);

    const results = await Promise.all([create("Delta"), create("Epsilon")]);

    expect(defaultsFor(OWNER, ORG)).toEqual(["pre_fix_duplicate_a"]);
    expect(results.every((result) => result.isDefault === false)).toBe(true);
  });
});

describe("builder design-system proxy insert path", () => {
  it("leaves exactly one default when several sources sync at once", async () => {
    await Promise.all([
      upsertProxy("ds_a"),
      upsertProxy("ds_b"),
      upsertProxy("ds_c"),
    ]);

    expect(defaultsFor(OWNER, ORG)).toHaveLength(1);
  });

  it("heals duplicate defaults instead of adding a third badge", async () => {
    seed({
      id: "older_default",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    seed({
      id: "racing_default",
      isDefault: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    await upsertProxy("ds_late");

    expect(defaultsFor(OWNER, ORG)).toEqual(["older_default"]);
  });
});
