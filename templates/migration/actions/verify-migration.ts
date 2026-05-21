import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  agentNativeTargetAdapter,
  createDefaultVerifiers,
  migrationContext,
  verifyMigration,
  type ProjectIR,
} from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import {
  getRunRow,
  loadTasks,
  replaceVerifierResults,
  rowToRun,
} from "./_utils.js";

export default defineAction({
  description: "Run deterministic verification and write the migration report.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
  }),
  run: async ({ id }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (!row.irJson) throw new Error("Run has no assessment IR.");
    const run = rowToRun(row);
    const ir = JSON.parse(row.irJson) as ProjectIR;
    const tasks = await loadTasks(id);
    const context = migrationContext(run, ir, tasks);
    const targetResults = agentNativeTargetAdapter.verify
      ? await agentNativeTargetAdapter.verify(context)
      : [];
    const report = await verifyMigration(context, createDefaultVerifiers());
    await replaceVerifierResults(id, [
      ...targetResults,
      ...report.verifierResults,
    ]);
    const hasOpenTasks = tasks.some(
      (task) => task.status === "pending" || task.status === "running",
    );
    const hasManualOrFailedTasks = tasks.some(
      (task) => task.status === "manual" || task.status === "failed",
    );
    const nextPhase =
      report.ok && !hasOpenTasks && !hasManualOrFailedTasks
        ? "complete"
        : hasOpenTasks
          ? "sweep"
          : "verify";
    const now = new Date().toISOString();
    const db = getDb();
    await db
      .update(schema.migrationRuns)
      .set({
        phase: nextPhase,
        reportPath: context.artifacts.reportPath,
        updatedAt: now,
      })
      .where(eq(schema.migrationRuns.id, id));
    return {
      report,
      targetResults,
      completed: nextPhase === "complete",
      blockedByTasks: hasOpenTasks || hasManualOrFailedTasks,
    };
  },
});
