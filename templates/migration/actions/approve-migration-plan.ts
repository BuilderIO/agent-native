import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { approveMigrationRun } from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import { getRunRow, rowToRun } from "./_utils.js";

export default defineAction({
  description:
    "Approve a generated migration plan. This unlocks generated output writes.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
  }),
  run: async ({ id }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (!row.planPath) {
      throw new Error(
        "Run has no plan yet. Run generate-migration-plan first.",
      );
    }
    const run = await approveMigrationRun(rowToRun(row));
    const db = getDb();
    await db
      .update(schema.migrationRuns)
      .set({
        phase: run.phase,
        approved: true,
        updatedAt: run.updatedAt,
      })
      .where(eq(schema.migrationRuns.id, id));
    return { run };
  },
});
