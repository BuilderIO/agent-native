import { describe, expect, it } from "vitest";

import * as schema from "./schema.js";

const DELIVERY_TRUTH_COLUMN =
  /delivery|delivered|attempt|retry|dead.?letter|errorMessage|error_message/i;

describe("Content workflow schema ownership", () => {
  it("keeps delivery attempts and retry truth in the core workflow ledger", () => {
    const contentWorkflowTables = Object.entries(schema).filter(([name]) =>
      /^content(?:Hook|Notification)/.test(name),
    );

    expect(contentWorkflowTables.length).toBeGreaterThan(0);
    for (const [tableName, table] of contentWorkflowTables) {
      const localColumns = Object.keys(table as object).filter(
        (key) => !key.startsWith("_"),
      );
      expect(
        localColumns.filter((column) => DELIVERY_TRUTH_COLUMN.test(column)),
        `${tableName} must project core delivery truth rather than store it`,
      ).toEqual([]);
    }

    expect(schema.notificationDeliveryAttempts).toBeDefined();
    expect(schema.workflowEffects).toBeDefined();
  });
});
