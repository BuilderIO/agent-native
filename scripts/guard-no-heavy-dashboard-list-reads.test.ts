import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findHeavyDashboardListReadViolations } from "./guard-no-heavy-dashboard-list-reads.mjs";

describe("heavy dashboard list read guard", () => {
  it("rejects collection reads that pull full rows or the config blob", () => {
    const source = `
      export async function listDashboards(db) {
        const rows = await db.select().from(schema.dashboards).where(eq(schema.dashboards.ownerEmail, "alice@example.com"));
        const configRows = await db.select({ id: schema.dashboards.id, config: schema.dashboards.config }).from(schema.dashboards);
        const spreadRows = await db.select({ ...schema.dashboards }).from(schema.dashboards);
        const queryRows = await db.query.dashboards.findMany();
        return { rows, configRows, spreadRows, queryRows };
      }
    `;

    const violations = findHeavyDashboardListReadViolations(
      "templates/analytics/server/lib/dashboards-store.ts",
      source,
      new Set([3, 4, 5, 6]),
    );

    assert.deepEqual(
      violations.map((violation) => violation.kind),
      ["empty-select", "config-projection", "full-row-select", "findMany"],
    );
  });

  it("allows point reads by id and deliberate opt-out pragmas", () => {
    const source = `
      export async function getDashboard(db, id) {
        const row = await db.select().from(schema.dashboards).where(eq(schema.dashboards.id, id));
        // guard:allow-heavy-dashboard-list-read — this is a detail view, not a collection path.
        const config = await db.select({ config: schema.dashboards.config }).from(schema.dashboards);
        return { row, config };
      }
    `;

    const violations = findHeavyDashboardListReadViolations(
      "templates/analytics/server/lib/dashboards-store.ts",
      source,
      new Set([3, 5]),
    );

    assert.deepEqual(violations, []);
  });
});
