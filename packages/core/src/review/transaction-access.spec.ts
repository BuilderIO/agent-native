import { PGlite } from "@electric-sql/pglite";
import { pgTable, text } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";

import { registerShareableResource } from "../sharing/registry.js";
import { createSharesTable } from "../sharing/schema.js";
import { assertReviewableResourceAccess } from "./registry.js";

it("rechecks current share permissions on the active transaction", async () => {
  const database = await PGlite.create("memory://");
  const documents = pgTable("transaction_review_docs", {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email"),
    orgId: text("org_id"),
    visibility: text("visibility"),
  });
  const shares = createSharesTable("transaction_review_shares");
  registerShareableResource({
    type: "transaction-review-test",
    displayName: "Document",
    resourceTable: documents,
    sharesTable: shares,
    getDb: () => {
      throw new Error("Opened a connection outside the transaction");
    },
  });
  try {
    await database.exec(`CREATE TABLE transaction_review_docs (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT, visibility TEXT);
      CREATE TABLE transaction_review_shares (resource_id TEXT, principal_type TEXT, principal_id TEXT, role TEXT);
      INSERT INTO transaction_review_docs VALUES ('doc', 'owner@example.test', NULL, 'private');
      INSERT INTO transaction_review_shares VALUES ('doc', 'user', 'editor@example.test', 'editor');`);
    await database.transaction(async (connection) => {
      const transaction = {
        execute: async (input: string | { sql: string; args?: unknown[] }) => {
          const result = await connection.query(
            typeof input === "string" ? input : input.sql,
            typeof input === "string" ? [] : input.args,
          );
          return {
            rows: result.rows as Record<string, unknown>[],
            rowsAffected: result.affectedRows ?? 0,
          };
        },
      };
      const context = { userEmail: "editor@example.test", transaction };
      expect(
        (
          await assertReviewableResourceAccess(
            "transaction-review-test",
            "doc",
            context,
            "editor",
          )
        ).role,
      ).toBe("editor");
      await connection.query(
        "UPDATE transaction_review_shares SET role = 'viewer'",
      );
      await expect(
        assertReviewableResourceAccess(
          "transaction-review-test",
          "doc",
          context,
          "editor",
        ),
      ).rejects.toThrow("Not allowed");
    });
  } finally {
    await database.close();
  }
});
