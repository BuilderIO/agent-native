import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { loadTasks } from "./_utils.js";

export default defineAction({
  description: "Get a Migration Workbench run with tasks and verifier results.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("migration-run", id);
    if (!access) throw new Error(`Migration run ${id} not found`);
    const run = access.resource as typeof schema.migrationRuns.$inferSelect;
    const db = getDb();
    const verifierRows = await db
      .select()
      .from(schema.migrationVerifierResults)
      .where(eq(schema.migrationVerifierResults.runId, id));
    return {
      run: {
        id: run.id,
        name: run.name,
        sourceRoot: run.sourceRoot,
        outputRoot: run.outputRoot,
        target: run.target,
        phase: run.phase,
        approved: run.approved,
        artifactDir: run.artifactDir,
        assessmentPath: run.assessmentPath,
        planPath: run.planPath,
        reportPath: run.reportPath,
        ir: run.irJson ? JSON.parse(run.irJson) : null,
        role: access.role,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
      tasks: await loadTasks(id),
      verifierResults: verifierRows.map((row) => ({
        id: row.verifierId,
        ok: row.ok,
        severity: row.severity,
        summary: row.summary,
        artifactPaths: JSON.parse(row.artifactPaths),
        suggestedNextTask: row.suggestedNextTask,
      })),
    };
  },
});
