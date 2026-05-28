import fs from "fs/promises";
import path from "path";
import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  agentNativeTargetAdapter,
  chooseCriticDecision,
  createDefaultVerifiers,
  discoverMigration,
  migrationContext,
  planMigration,
  verifyMigration,
  type CriticDecision,
  type MigrationTask,
  type ProjectIR,
  type TargetAdapterResult,
  type VerifierResult,
} from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";
import {
  assessmentSourceMetadata,
  getRunRow,
  loadTasks,
  parsePlanInputsJson,
  replaceTasks,
  replaceVerifierResults,
  rowToRun,
} from "./_utils.js";

const MAX_TASKS_PER_GOAL_RUN = 5;

type GoalStepStatus = "completed" | "skipped" | "blocked" | "failed";

interface GoalStep {
  name: string;
  status: GoalStepStatus;
  summary: string;
}

export default defineAction({
  description:
    "Advance a Migration Workbench run toward the migration goal. It assesses/plans safely, stops for approval before output writes, then runs a bounded approved sweep and verification.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
    maxTasks: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_TASKS_PER_GOAL_RUN)
      .default(1)
      .describe("Maximum pending tasks to advance in this bounded run."),
    verify: z.coerce
      .boolean()
      .default(true)
      .describe("Run deterministic verification after any approved work."),
  }),
  run: async ({ id, maxTasks, verify }) => {
    await assertAccess("migration-run", id, "editor");

    const db = getDb();
    const steps: GoalStep[] = [];
    let row = await getRunRow(id);
    let tasks = await loadTasks(id);
    let scaffoldResult: TargetAdapterResult | null = null;
    let verifierResults: VerifierResult[] = [];
    let reportPath = row.reportPath;
    let criticDecision: CriticDecision | null = null;

    if (!row.irJson) {
      const run = rowToRun(row);
      const result = await discoverMigration(run);
      await db
        .update(schema.migrationRuns)
        .set({
          phase: result.run.phase,
          assessmentPath: result.assessmentPath,
          irJson: JSON.stringify(result.ir),
          updatedAt: result.run.updatedAt,
        })
        .where(eq(schema.migrationRuns.id, id));
      steps.push({
        name: "assess",
        status: "completed",
        summary: `Assessed ${result.run.inputKind} input with ${result.ir.site.routes.length} route(s) and ${result.ir.behavior.apiEndpoints.length} API endpoint(s).`,
      });
      row = await getRunRow(id);
      tasks = await loadTasks(id);
    } else {
      steps.push({
        name: "assess",
        status: "skipped",
        summary: "Assessment IR already exists.",
      });
    }

    if (!row.planPath) {
      const ir = JSON.parse(row.irJson ?? "{}") as ProjectIR;
      const result = await planMigration(rowToRun(row), ir, {
        planInputs: parsePlanInputsJson(row.planInputsJson),
      });
      await replaceTasks(id, result.tasks);
      await db
        .update(schema.migrationRuns)
        .set({
          phase: result.run.phase,
          planPath: result.planPath,
          updatedAt: result.run.updatedAt,
        })
        .where(eq(schema.migrationRuns.id, id));
      steps.push({
        name: "plan",
        status: "completed",
        summary: `Generated ${result.tasks.length} migration task(s).`,
      });
      row = await getRunRow(id);
      tasks = await loadTasks(id);
    } else {
      steps.push({
        name: "plan",
        status: "skipped",
        summary: "Migration plan and task inventory already exist.",
      });
    }

    if (!row.approved) {
      criticDecision = chooseCriticDecision({
        attempts: 1,
        verifierOk: false,
        hasManualGap: true,
      });
      steps.push({
        name: "approval",
        status: "blocked",
        summary: "Plan approval is required before generated output writes.",
      });
      return buildStatus({
        status: "approval_required",
        row,
        tasks,
        steps,
        verifierResults,
        criticDecision,
        nextAction:
          "Review the generated plan, then run approve-migration-plan.",
      });
    }

    steps.push({
      name: "approval",
      status: "completed",
      summary: "Plan is approved; generated output writes are allowed.",
    });

    const manifestPath = path.join(row.artifactDir, "generated-files.json");
    let scaffoldExists = await pathExists(manifestPath);

    if (!scaffoldExists && maxTasks > 0) {
      const selected = firstPendingTask(tasks);
      if (selected) await setTaskStatus(selected.id, "running");

      const context = migrationContext(
        rowToRun(row),
        JSON.parse(row.irJson ?? "{}") as ProjectIR,
        tasks,
      );
      scaffoldResult = await agentNativeTargetAdapter.scaffold(context);

      if (selected) {
        await setTaskStatus(
          selected.id,
          scaffoldResult.ok ? "covered" : "failed",
        );
      }
      scaffoldExists = await pathExists(manifestPath);
      steps.push({
        name: "scaffold",
        status: scaffoldResult.ok ? "completed" : "failed",
        summary: scaffoldResult.summary,
      });
      tasks = await loadTasks(id);
    } else if (!scaffoldExists) {
      steps.push({
        name: "scaffold",
        status: "skipped",
        summary: "Skipped generated output writes because maxTasks is 0.",
      });
    } else {
      steps.push({
        name: "scaffold",
        status: "skipped",
        summary: "Generated output scaffold has already been written.",
      });
    }

    if (scaffoldExists && scaffoldResult?.ok !== false) {
      const remainingSlots = Math.max(
        0,
        maxTasks - (scaffoldResult?.ok ? 1 : 0),
      );
      const advanced = firstPendingTasks(tasks, remainingSlots);
      for (const task of advanced) {
        await setTaskStatus(task.id, "covered");
      }
      steps.push({
        name: "task-sweep",
        status: advanced.length > 0 ? "completed" : "skipped",
        summary:
          advanced.length > 0
            ? `Marked ${advanced.length} pending task(s) as covered by scaffold output.`
            : "No additional pending tasks were advanced in this bounded run.",
      });
      tasks = await loadTasks(id);
    }

    const taskSummaryBeforeVerify = summarizeTasks(tasks);
    await db
      .update(schema.migrationRuns)
      .set({
        phase:
          taskSummaryBeforeVerify.pending + taskSummaryBeforeVerify.running > 0
            ? "sweep"
            : "verify",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.migrationRuns.id, id));
    row = await getRunRow(id);

    if (verify) {
      const context = migrationContext(
        rowToRun(row),
        JSON.parse(row.irJson ?? "{}") as ProjectIR,
        tasks,
      );
      const targetResults = agentNativeTargetAdapter.verify
        ? await agentNativeTargetAdapter.verify(context)
        : [];
      const report = await verifyMigration(context, createDefaultVerifiers());
      verifierResults = [...targetResults, ...report.verifierResults];
      await replaceVerifierResults(id, verifierResults);

      const taskSummary = summarizeTasks(tasks);
      const verifierOk = verifierResults.every((result) => result.ok);
      const hasManualGap =
        taskSummary.manual > 0 ||
        taskSummary.failed > 0 ||
        taskSummary.pending > 0 ||
        taskSummary.running > 0;
      criticDecision = chooseCriticDecision({
        attempts: Math.max(1, taskSummary.failed + 1),
        verifierOk: verifierOk && !hasManualGap,
        hasManualGap,
      });

      reportPath = context.artifacts.reportPath;
      await db
        .update(schema.migrationRuns)
        .set({
          phase: verifierOk && !hasManualGap ? "complete" : row.phase,
          reportPath,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.migrationRuns.id, id));
      steps.push({
        name: "verify",
        status: verifierOk ? "completed" : "failed",
        summary: report.summary,
      });
      row = await getRunRow(id);
    } else {
      steps.push({
        name: "verify",
        status: "skipped",
        summary: "Verification was skipped by request.",
      });
    }

    const finalTaskSummary = summarizeTasks(tasks);
    const verifierOk =
      verifierResults.length === 0 ||
      verifierResults.every((result) => result.ok);
    const status =
      row.phase === "complete"
        ? "complete"
        : !verify
          ? "advanced"
          : !verifierOk || finalTaskSummary.failed > 0
            ? "needs_follow_up"
            : finalTaskSummary.pending + finalTaskSummary.running > 0
              ? "advanced"
              : "verified";

    return buildStatus({
      status,
      row,
      tasks,
      steps,
      verifierResults,
      scaffoldResult,
      criticDecision,
      reportPath,
      nextAction: nextActionFor(status),
    });
  },
});

async function setTaskStatus(id: string, status: MigrationTask["status"]) {
  const db = getDb();
  await db
    .update(schema.migrationTasks)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.migrationTasks.id, id));
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function firstPendingTask(tasks: MigrationTask[]) {
  return tasks.find((task) => task.status === "pending");
}

function firstPendingTasks(tasks: MigrationTask[], limit: number) {
  if (limit <= 0) return [];
  return tasks.filter((task) => task.status === "pending").slice(0, limit);
}

function summarizeTasks(tasks: MigrationTask[]) {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    running: tasks.filter((task) => task.status === "running").length,
    passed: tasks.filter((task) => task.status === "passed").length,
    covered: tasks.filter((task) => task.status === "covered").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    manual: tasks.filter((task) => task.status === "manual").length,
  };
}

function buildStatus(args: {
  status: string;
  row: typeof schema.migrationRuns.$inferSelect;
  tasks: MigrationTask[];
  steps: GoalStep[];
  verifierResults: VerifierResult[];
  scaffoldResult?: TargetAdapterResult | null;
  criticDecision: CriticDecision | null;
  reportPath?: string | null;
  nextAction: string;
}) {
  return {
    status: args.status,
    run: {
      id: args.row.id,
      name: args.row.name,
      phase: args.row.phase,
      approved: args.row.approved,
      sourceRoot: args.row.sourceRoot,
      inputKind: args.row.inputKind,
      inputDescription: args.row.inputDescription,
      outputRoot: args.row.outputRoot,
      assessmentPath: args.row.assessmentPath,
      planPath: args.row.planPath,
      reportPath: args.reportPath ?? args.row.reportPath,
    },
    assessmentSource: assessmentSourceMetadata(
      args.row.irJson ? (JSON.parse(args.row.irJson) as ProjectIR) : null,
    ),
    approvalRequired: Boolean(args.row.planPath && !args.row.approved),
    taskSummary: summarizeTasks(args.tasks),
    steps: args.steps,
    scaffold: args.scaffoldResult
      ? {
          ok: args.scaffoldResult.ok,
          summary: args.scaffoldResult.summary,
          changedFileCount: args.scaffoldResult.changedFiles.length,
          artifactPaths: args.scaffoldResult.artifactPaths,
        }
      : null,
    verification: {
      ok:
        args.verifierResults.length > 0
          ? args.verifierResults.every((result) => result.ok)
          : null,
      results: args.verifierResults.map((result) => ({
        id: result.id,
        ok: result.ok,
        severity: result.severity,
        summary: result.summary,
        suggestedNextTask: result.suggestedNextTask,
      })),
    },
    criticDecision: args.criticDecision,
    nextAction: args.nextAction,
  };
}

function nextActionFor(status: string) {
  if (status === "complete") return "Migration goal is complete.";
  if (status === "needs_follow_up") {
    return "Review verifier results and follow the critic decision before rerunning.";
  }
  if (status === "advanced") {
    return "Run run-migration-goal again to continue the bounded sweep.";
  }
  return "Review the verification report.";
}
