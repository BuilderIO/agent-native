import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  agentNativeTargetAdapter,
  migrationContext,
  type ProjectIR,
} from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import { getRunRow, loadTasks, rowToRun } from "./_utils.js";

export default defineAction({
  description:
    "Run a Migration Workbench task. V1 scaffolds the approved agent-native output and marks the selected task as covered by scaffold output.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
    taskId: z
      .string()
      .optional()
      .describe("Task ID. Defaults to the first pending task."),
  }),
  run: async ({ id, taskId }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (!row.approved) {
      throw new Error("Plan must be approved before running migration tasks.");
    }
    if (!row.irJson) throw new Error("Run has no assessment IR.");
    const run = rowToRun(row);
    const ir = JSON.parse(row.irJson) as ProjectIR;
    const tasks = await loadTasks(id);
    const selected =
      tasks.find((task) => task.id === taskId) ??
      tasks.find((task) => task.status === "pending");
    if (!selected) throw new Error("No pending migration task found.");
    const db = getDb();
    await db
      .update(schema.migrationTasks)
      .set({ status: "running", updatedAt: new Date().toISOString() })
      .where(eq(schema.migrationTasks.id, selected.id));

    const context = migrationContext(run, ir, tasks);
    const result = await agentNativeTargetAdapter.scaffold(context);
    await db
      .update(schema.migrationTasks)
      .set({
        status: result.ok ? "covered" : "failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.migrationTasks.id, selected.id));
    const remainingTasks = await loadTasks(id);
    const hasPendingTasks = remainingTasks.some(
      (task) => task.status === "pending" || task.status === "running",
    );
    await db
      .update(schema.migrationRuns)
      .set({
        phase: hasPendingTasks ? "sweep" : "verify",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.migrationRuns.id, id));
    return { task: selected, result };
  },
});
