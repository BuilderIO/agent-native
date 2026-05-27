import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { discoverMigration } from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import { assessmentSourceMetadata, getRunRow, rowToRun } from "./_utils.js";

export default defineAction({
  description:
    "Discover a migration source and write the assessment artifact. This reads the source project but does not mutate it.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
  }),
  run: async ({ id }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (row.planPath) {
      throw new Error(
        "Run already has a generated plan. Create a new run or use a dedicated reset flow before reassessing the source.",
      );
    }
    const run = rowToRun(row);
    const result = await discoverMigration(run);
    const db = getDb();
    await db
      .update(schema.migrationRuns)
      .set({
        phase: result.run.phase,
        assessmentPath: result.assessmentPath,
        irJson: JSON.stringify(result.ir),
        updatedAt: result.run.updatedAt,
      })
      .where(eq(schema.migrationRuns.id, id));
    const assessmentSource = assessmentSourceMetadata(result.ir);
    return {
      run: result.run,
      assessmentPath: result.assessmentPath,
      assessmentSource,
      source: assessmentSource?.source ?? result.ir.site.framework,
      needsAgentIntrospection:
        assessmentSource?.needsAgentIntrospection ?? false,
      inputKind: result.run.inputKind,
      inputDescription: result.run.inputDescription,
      routeCount: result.ir.site.routes.length,
      apiEndpointCount: result.ir.behavior.apiEndpoints.length,
    };
  },
});
