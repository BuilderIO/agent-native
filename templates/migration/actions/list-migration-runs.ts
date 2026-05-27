import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { parsePlanInputsJson } from "./_utils.js";

export default defineAction({
  description: "List Migration Workbench runs.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const runs = await db
      .select()
      .from(schema.migrationRuns)
      .where(accessFilter(schema.migrationRuns, schema.migrationRunShares))
      .orderBy(desc(schema.migrationRuns.updatedAt));
    const counts = await db
      .select({
        runId: schema.migrationTasks.runId,
        count: sql<number>`count(*)`,
      })
      .from(schema.migrationTasks)
      .groupBy(schema.migrationTasks.runId);
    const passed = await db
      .select({
        runId: schema.migrationTasks.runId,
        count: sql<number>`count(*)`,
      })
      .from(schema.migrationTasks)
      .where(eq(schema.migrationTasks.status, "passed"))
      .groupBy(schema.migrationTasks.runId);
    const covered = await db
      .select({
        runId: schema.migrationTasks.runId,
        count: sql<number>`count(*)`,
      })
      .from(schema.migrationTasks)
      .where(eq(schema.migrationTasks.status, "covered"))
      .groupBy(schema.migrationTasks.runId);
    const failed = await db
      .select({
        runId: schema.migrationTasks.runId,
        count: sql<number>`count(*)`,
      })
      .from(schema.migrationTasks)
      .where(eq(schema.migrationTasks.status, "failed"))
      .groupBy(schema.migrationTasks.runId);
    const byRun = (rows: Array<{ runId: string; count: number }>) =>
      new Map(rows.map((row) => [row.runId, Number(row.count)]));
    const countMap = byRun(counts);
    const passedMap = byRun(passed);
    const coveredMap = byRun(covered);
    const failedMap = byRun(failed);
    return {
      runs: runs.map((run) => ({
        id: run.id,
        name: run.name,
        sourceRoot: run.sourceRoot,
        inputKind: run.inputKind,
        inputDescription: run.inputDescription,
        outputRoot: run.outputRoot,
        target: run.target,
        phase: run.phase,
        approved: run.approved,
        hasPlanInputs: Boolean(parsePlanInputsJson(run.planInputsJson)),
        taskCount: countMap.get(run.id) ?? 0,
        passedTaskCount: passedMap.get(run.id) ?? 0,
        coveredTaskCount: coveredMap.get(run.id) ?? 0,
        failedTaskCount: failedMap.get(run.id) ?? 0,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
    };
  },
});
