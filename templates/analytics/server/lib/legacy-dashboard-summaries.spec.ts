import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => state }));
import { listLegacyDashboardSummaries } from "./legacy-dashboard-summaries.js";

const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    "CREATE TABLE settings(key text primary key,value text); CREATE TABLE dashboards(id text primary key)",
  );
  state.execute.mockImplementation(
    ({ sql, args }: { sql: string; args: unknown[] }) => {
      let index = 0;
      return db.query(
        sql.replace(/\?/g, () => `$${++index}`),
        args,
      );
    },
  );
});
afterAll(() => db.close());
describe("legacy dashboard metadata", () => {
  it("filters scoped metadata before limiting and excludes native IDs even when native access is denied", async () => {
    const values = [
      ["u:other@example.test:sql-dashboard-private", { name: "Match private" }],
      ["o:other-org:sql-dashboard-other", { name: "Match other" }],
      ["u:viewer@example.test:sql-dashboard-unrelated", { name: "Unrelated" }],
      ["u:viewer@example.test:sql-dashboard-shadow", { name: "Match shadow" }],
      [
        "u:viewer@example.test:sql-dashboard-match",
        {
          name: "Match personal",
          description: "x".repeat(700),
          sql: "SECRET BODY",
        },
      ],
      ["o:org-one:sql-dashboard-shared", { name: "Match org" }],
      [
        "u:viewer@example.test:sql-dashboard-shared",
        { name: "Wrong personal title" },
      ],
      ["o:org-one:dashboard-not-supported", { name: "Match explorer" }],
    ] as const;
    for (const [key, value] of values)
      await db.query("INSERT INTO settings VALUES($1,$2)", [
        key,
        JSON.stringify(value),
      ]);
    await db.query("INSERT INTO dashboards VALUES($1)", ["shadow"]);
    const ctx = { email: "viewer@example.test", orgId: "org-one" };
    const rows = await listLegacyDashboardSummaries(ctx, {
      search: "Match",
      limit: 1,
    });
    expect(rows).toEqual([
      {
        id: "match",
        kind: "sql",
        name: "Match personal",
        description: "x".repeat(500),
        createdAt: "",
        updatedAt: "",
        orgId: null,
      },
    ]);
    // oracle-change: native shadow suppression is checked through the scoped legacy result.
    expect(
      await listLegacyDashboardSummaries(ctx, { id: "shadow", limit: 1 }),
    ).toEqual([]);
    expect(
      await listLegacyDashboardSummaries(ctx, { id: "shared", limit: 1 }),
    ).toMatchObject([{ name: "Match org", orgId: "org-one" }]);
    expect(
      (
        await listLegacyDashboardSummaries(ctx, { search: "Match", limit: 20 })
      ).map((row) => row.id),
    ).toEqual(["match", "shared"]);
  });
  it("reports unreadable legacy metadata instead of pretending there are no sources", async () => {
    await db.query("INSERT INTO settings VALUES($1,$2)", [
      "u:broken@example.test:sql-dashboard-broken",
      "invalid JSON",
    ]);
    await expect(
      listLegacyDashboardSummaries(
        { email: "broken@example.test", orgId: null },
        { limit: 20 },
      ),
    ).rejects.toThrow();
  });
});
