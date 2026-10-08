import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let writes: Array<{ sql: string; args: unknown[] }> = [];
let failLearnSharedApprovalMigration = false;

const sharedClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === "string" ? arg : arg.sql;
    const args = typeof arg === "string" ? [] : (arg.args ?? []);
    if (!/^\s*(select|create)/i.test(sql)) writes.push({ sql, args });
    if (
      failLearnSharedApprovalMigration &&
      /^\s*UPDATE resources SET content = \?/i.test(sql)
    ) {
      throw new Error("injected migration failure");
    }
    if (/^\s*create/i.test(sql)) {
      await pglite.exec(sql);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(sql);
    if (/^\s*select/i.test(sql)) {
      return { rows: await stmt.all(...(args as any[])), rowsAffected: 0 };
    }
    const result = await stmt.run(...(args as any[]));
    return { rows: [], rowsAffected: Number(result.changes ?? 0) };
  },
};

function seedInserts(): string[] {
  return writes
    .filter(({ sql }) => /INSERT (OR IGNORE )?INTO resources/i.test(sql))
    .map(({ sql }) => sql);
}

function learnSharedContentMigrationPaths(): unknown[] {
  return writes
    .filter(({ sql }) => /^UPDATE resources SET content = \?/i.test(sql.trim()))
    .map(({ args }) => args[4]);
}

beforeEach(async () => {
  pglite = await createTestPglite();
  writes = [];
  failLearnSharedApprovalMigration = false;
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await pglite.close();
});

describe("default resource seeding is once per database, not per process", () => {
  it("skips every seed write on a second cold start", async () => {
    const first = await import("./store.js");
    await first.resourceList("__shared__");
    const firstSeeds = seedInserts().length;
    expect(firstSeeds).toBeGreaterThan(0);
    expect(learnSharedContentMigrationPaths()).toEqual([
      "skills/learn-shared/SKILL.md",
      "skills/learn-shared.md",
    ]);

    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.resourceList("__shared__");

    expect(seedInserts()).toEqual([]);
    expect(learnSharedContentMigrationPaths()).toEqual([]);
  });

  it("still seeds a database that has never been seeded", async () => {
    const store = await import("./store.js");
    const rows = await store.resourceList("__shared__");
    const paths = rows.map((r) => r.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("LEARNINGS.md");
  });

  it("does not recreate a deleted shared skill while its migration runs", async () => {
    const first = await import("./store.js");
    await first.resourceList("__shared__");
    await sharedClient.execute({
      sql: "DELETE FROM resources WHERE owner = ? AND path = ?",
      args: ["__shared__", "skills/learn-shared/SKILL.md"],
    });
    await sharedClient.execute({
      sql: "DELETE FROM public.settings WHERE key = ?",
      args: ["resources-migrated:shared:learn-shared-approval:v1"],
    });

    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.resourceList("__shared__");

    expect(
      await second.resourceGetByPath(
        "__shared__",
        "skills/learn-shared/SKILL.md",
      ),
    ).toBeNull();
    expect(seedInserts()).toEqual([]);
    expect(learnSharedContentMigrationPaths()).toEqual([
      "skills/learn-shared/SKILL.md",
      "skills/learn-shared.md",
    ]);
  });

  it("keeps initialization available and retries a failed approval migration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failLearnSharedApprovalMigration = true;

    const first = await import("./store.js");
    const rows = await first.resourceList("__shared__");

    expect(rows.map((row) => row.path)).toContain("AGENTS.md");
    expect(rows.map((row) => row.path)).toContain("LEARNINGS.md");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(
      writes.some(({ args }) =>
        args.includes("resources-migrated:shared:learn-shared-approval:v1"),
      ),
    ).toBe(false);

    failLearnSharedApprovalMigration = false;
    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.resourceList("__shared__");

    expect(learnSharedContentMigrationPaths()).toEqual([
      "skills/learn-shared/SKILL.md",
      "skills/learn-shared.md",
    ]);
    expect(
      writes.some(({ args }) =>
        args.includes("resources-migrated:shared:learn-shared-approval:v1"),
      ),
    ).toBe(true);
  });

  it("does not re-seed personal defaults for the same owner on a new process", async () => {
    const first = await import("./store.js");
    await first.ensurePersonalDefaults("user@example.com");
    const firstSeeds = seedInserts().length;
    expect(firstSeeds).toBeGreaterThan(0);

    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.ensurePersonalDefaults("user@example.com");
    expect(seedInserts()).toEqual([]);
  });

  it("seeds a DIFFERENT owner even after the first is marked", async () => {
    const store = await import("./store.js");
    await store.ensurePersonalDefaults("first@example.com");
    writes = [];
    await store.ensurePersonalDefaults("second@example.com");
    expect(seedInserts().length).toBeGreaterThan(0);
  });

  it("keys the personal marker case-insensitively on the owner", async () => {
    const store = await import("./store.js");
    await store.ensurePersonalDefaults("Mixed@Example.com");
    writes = [];
    vi.resetModules();
    const second = await import("./store.js");
    await second.ensurePersonalDefaults("mixed@example.com");
    expect(seedInserts()).toEqual([]);
  });
});
