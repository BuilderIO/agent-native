import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ProjectIR } from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import {
  assessmentSourceMetadata,
  getRunRow,
  loadTasks,
  parsePlanInputsJson,
} from "./_utils.js";

export default defineAction({
  description:
    "See the current Migration Workbench screen, including selected run and goal context when available.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState("navigation")) as {
      runId?: string;
      view?: string;
    } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (navigation?.runId) {
      try {
        const row = await getRunRow(navigation.runId);
        const ir = row.irJson ? (JSON.parse(row.irJson) as ProjectIR) : null;
        screen.run = {
          id: row.id,
          name: row.name,
          phase: row.phase,
          approved: row.approved,
          sourceRoot: row.sourceRoot,
          inputKind: row.inputKind,
          inputDescription: row.inputDescription,
          outputRoot: row.outputRoot,
          planInputs: parsePlanInputsJson(row.planInputsJson),
          assessmentPath: row.assessmentPath,
          planPath: row.planPath,
          reportPath: row.reportPath,
          assessmentSource: assessmentSourceMetadata(ir),
        };
        const tasks = await loadTasks(row.id);
        const db = getDb();
        const verifierResults = await db
          .select()
          .from(schema.migrationVerifierResults)
          .where(eq(schema.migrationVerifierResults.runId, row.id));
        screen.tasks = tasks;
        screen.verifierResults = verifierResults.map((result) => ({
          id: result.verifierId,
          ok: result.ok,
          severity: result.severity,
          summary: result.summary,
          suggestedNextTask: result.suggestedNextTask,
        }));
        screen.goal = describeGoal(row, tasks, verifierResults);
      } catch (error) {
        screen.runError =
          error instanceof Error ? error.message : "Unable to load run";
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No Migration Workbench application state found. Is the app running?";
    }
    return screen;
  },
});

function describeGoal(
  row: typeof schema.migrationRuns.$inferSelect,
  tasks: Array<{ status: string }>,
  verifierResults: Array<{ ok: boolean }>,
) {
  const pending = tasks.filter((task) => task.status === "pending").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const covered = tasks.filter((task) => task.status === "covered").length;
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const failedVerifiers = verifierResults.filter((result) => !result.ok).length;
  const approvalRequired = Boolean(row.planPath && !row.approved);
  return {
    action: "run-migration-goal",
    approvalRequired,
    canWriteOutput: row.approved,
    pendingTaskCount: pending + running,
    coveredTaskCount: covered,
    failedTaskCount: failedTasks,
    failedVerifierCount: failedVerifiers,
    nextAction: !row.irJson
      ? "run-migration-goal will assess and plan without output writes"
      : !row.planPath
        ? "run-migration-goal will generate a plan"
        : approvalRequired
          ? "approve-migration-plan is required before output writes"
          : pending + running > 0
            ? "run-migration-goal can advance the bounded sweep"
            : "run-migration-goal can refresh verification",
  };
}
