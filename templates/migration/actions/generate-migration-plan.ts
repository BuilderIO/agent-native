import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { planMigration, type ProjectIR } from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import {
  getRunRow,
  parsePlanInputsJson,
  replaceTasks,
  rowToRun,
} from "./_utils.js";

export default defineAction({
  description:
    "Generate a migration plan and task list from the assessment IR. Requires human approval before output writes.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
  }),
  run: async ({ id }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (!row.irJson) {
      throw new Error(
        "Run has no assessment IR yet. Run assess-migration first.",
      );
    }
    if (row.planPath) {
      throw new Error(
        "Run already has a generated plan. Create a new run or use a dedicated reset flow before regenerating tasks.",
      );
    }
    const run = rowToRun(row);
    const ir = JSON.parse(row.irJson) as ProjectIR;
    const result = await planMigration(run, ir, {
      planInputs: parsePlanInputsJson(row.planInputsJson),
    });
    await replaceTasks(id, result.tasks);
    const db = getDb();
    await db
      .update(schema.migrationRuns)
      .set({
        phase: result.run.phase,
        planPath: result.planPath,
        updatedAt: result.run.updatedAt,
      })
      .where(eq(schema.migrationRuns.id, id));
    return {
      run: result.run,
      planPath: result.planPath,
      taskCount: result.tasks.length,
      tasks: result.tasks,
    };
  },
});
