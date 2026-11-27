import { describe, expect, it } from "vitest";

import duplicateDatabaseItem from "../../actions/duplicate-database-item";
import duplicateDatabaseItems from "../../actions/duplicate-database-items";
import patchDatabaseItems from "../../actions/patch-database-items";
import removeDatabaseItems from "../../actions/remove-database-items";
import updateDatabaseItem from "../../actions/update-database-item";

// oracle-change: the source-text checks are gone. DatabaseView's batch removal is covered by "removes the confirmed selection snapshot without clearing newer selections" and batch duplication by "duplicates every selected row in one batch call" (DatabaseView.error-toasts.test.tsx); remove-database-items' collection lock by "removing a collection row" in lifecycle-lock-order.postgres.integration.test.ts; DocumentDatabase's DatabaseView import and re-export by typecheck. The descriptions are now read from the action definitions the agent sees.
describe("database row batch reliability", () => {
  it("keeps agent-facing descriptions biased toward batch tools for multi-row work", () => {
    expect(duplicateDatabaseItems.tool.description).toContain(
      "Use this for two or more selected/named rows instead of looping duplicate-database-item",
    );
    expect(removeDatabaseItems.tool.description).toContain(
      "without deleting the pages",
    );
    expect(duplicateDatabaseItem.tool.description).toContain(
      "For two or more rows, use duplicate-database-items once instead of looping this action",
    );
    for (const batchAction of [duplicateDatabaseItems, removeDatabaseItems]) {
      expect(JSON.stringify(batchAction.tool.parameters)).toContain(
        "Native JSON array of collection row item IDs",
      );
    }
    expect(patchDatabaseItems.tool.description).toContain(
      "Apply a different sparse patch to each of up to",
    );
    expect(updateDatabaseItem.tool.description).toContain(
      "use patch-database-items once instead of looping this action",
    );
  });
});
