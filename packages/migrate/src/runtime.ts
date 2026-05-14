import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { createAgentNativeRecipes } from "./recipes/agent-native.js";
import type {
  CriticDecision,
  MigrationArtifacts,
  MigrationContext,
  MigrationReport,
  MigrationRun,
  MigrationTask,
  ProjectIR,
  SourceAdapter,
  Verifier,
} from "./types.js";

export interface CreateMigrationRunOptions {
  sourceRoot: string;
  outputRoot: string;
  artifactRoot: string;
  target?: string;
  id?: string;
}

export async function createMigrationRun(
  options: CreateMigrationRunOptions,
): Promise<MigrationRun> {
  const now = new Date().toISOString();
  const id = options.id ?? `mig_${nanoid(10)}`;
  const artifactDir = path.resolve(options.artifactRoot, id);
  await fs.mkdir(artifactDir, { recursive: true });
  const run: MigrationRun = {
    id,
    sourceRoot: path.resolve(options.sourceRoot),
    outputRoot: path.resolve(options.outputRoot),
    target: options.target ?? "agent-native",
    phase: "discover",
    approved: false,
    createdAt: now,
    updatedAt: now,
    artifactDir,
  };
  await writeJson(path.join(artifactDir, "run.json"), run);
  return run;
}

export function artifactPaths(run: MigrationRun): MigrationArtifacts {
  return {
    runDir: run.artifactDir,
    assessmentPath: path.join(run.artifactDir, "01-assessment.md"),
    planPath: path.join(run.artifactDir, "02-plan.md"),
    tasksPath: path.join(run.artifactDir, "03-tasks.md"),
    reportPath: path.join(run.artifactDir, "04-report.md"),
    irPath: path.join(run.artifactDir, "ir.json"),
  };
}

export async function discoverMigration(
  run: MigrationRun,
  sourceAdapter: SourceAdapter,
): Promise<{ run: MigrationRun; ir: ProjectIR; assessmentPath: string }> {
  const ir = await sourceAdapter.introspect(run.sourceRoot);
  const updated = touch({ ...run, phase: "plan" as const, ir });
  const artifacts = artifactPaths(updated);
  await fs.mkdir(artifacts.runDir, { recursive: true });
  await writeJson(artifacts.irPath, ir);
  await fs.writeFile(artifacts.assessmentPath, renderAssessment(updated, ir));
  await writeJson(path.join(updated.artifactDir, "run.json"), updated);
  return { run: updated, ir, assessmentPath: artifacts.assessmentPath };
}

export async function planMigration(
  run: MigrationRun,
  ir: ProjectIR,
): Promise<{ run: MigrationRun; tasks: MigrationTask[]; planPath: string }> {
  const context = migrationContext(run, ir, []);
  const recipes = createAgentNativeRecipes();
  const taskGroups = await Promise.all(
    recipes.map((recipe) => recipe.selectTasks(context)),
  );
  const tasks = taskGroups.flat();
  const updated = touch({ ...run, phase: "approve" as const });
  const artifacts = artifactPaths(updated);
  await fs.writeFile(artifacts.planPath, renderPlan(updated, ir, tasks));
  await fs.writeFile(artifacts.tasksPath, renderTasks(tasks));
  await writeJson(path.join(updated.artifactDir, "tasks.json"), tasks);
  await writeJson(path.join(updated.artifactDir, "run.json"), updated);
  return { run: updated, tasks, planPath: artifacts.planPath };
}

export async function approveMigrationRun(
  run: MigrationRun,
): Promise<MigrationRun> {
  const updated = touch({ ...run, phase: "sweep" as const, approved: true });
  await writeJson(path.join(updated.artifactDir, "run.json"), updated);
  return updated;
}

export function migrationContext(
  run: MigrationRun,
  ir: ProjectIR,
  tasks: MigrationTask[],
  logger?: (message: string) => void,
): MigrationContext {
  return {
    run,
    ir,
    tasks,
    artifacts: artifactPaths(run),
    logger,
  };
}

export async function verifyMigration(
  context: MigrationContext,
  verifiers: Verifier[],
): Promise<MigrationReport> {
  const verifierResults = [];
  for (const verifier of verifiers) {
    verifierResults.push(await verifier.run(context));
  }
  const ok = verifierResults.every((result) => result.ok);
  const report: MigrationReport = {
    runId: context.run.id,
    ok,
    generatedAt: new Date().toISOString(),
    summary: ok
      ? "All configured verifiers passed."
      : "One or more verifiers need follow-up.",
    verifierResults,
    manualDecisions: context.tasks
      .filter((task) => task.status === "manual")
      .map((task) => task.title),
  };
  await fs.writeFile(context.artifacts.reportPath, renderReport(report));
  await writeJson(path.join(context.artifacts.runDir, "report.json"), report);
  return report;
}

export function chooseCriticDecision(args: {
  attempts: number;
  verifierOk: boolean;
  hasManualGap: boolean;
}): CriticDecision {
  if (args.verifierOk) return "accept";
  if (args.hasManualGap) return "manual-decision-needed";
  if (args.attempts <= 1) return "retry-with-more-context";
  if (args.attempts <= 3) return "tune-recipe";
  return "rollback-generated-output";
}

function renderAssessment(run: MigrationRun, ir: ProjectIR): string {
  const routes = ir.site.routes;
  return `# Migration Assessment

Source: \`${run.sourceRoot}\`
Output: \`${run.outputRoot}\`
Target: \`${run.target}\`

## Inventory

- Framework: ${ir.site.framework}
- Routes: ${routes.length}
- Components: ${ir.components.components.length}
- API endpoints: ${ir.behavior.apiEndpoints.length}
- Data stores: ${ir.behavior.dataStores.length}
- LLM calls: ${ir.behavior.llmCalls.length}
- Assets: ${ir.content.assets.length}

## Routes

${routes.map((route) => `- \`${route.path}\` (${route.kind}) from \`${route.filePath}\``).join("\n") || "- No routes detected."}
`;
}

function renderPlan(
  run: MigrationRun,
  ir: ProjectIR,
  tasks: MigrationTask[],
): string {
  const confidence = {
    high: tasks.filter((task) => task.confidence === "high").length,
    medium: tasks.filter((task) => task.confidence === "medium").length,
    low: tasks.filter((task) => task.confidence === "low").length,
  };
  return `# Migration Plan

Run: \`${run.id}\`

This plan follows the agent-native migration rules: actions, SQL, agent chat delegation, application state, optimistic UI, sharing helpers, SSR for public pages, and a persistent app shell for logged-in workflows.

## Confidence

- High: ${confidence.high}
- Medium: ${confidence.medium}
- Low: ${confidence.low}

## Sample / Tune / Sweep

Start with a representative sample of ${Math.min(5, Math.max(1, ir.site.routes.length))} route(s), tune recipes until those pass verification, then sweep the remaining route inventory.

## Tasks

${tasks.map((task) => `- [ ] **${task.recipeName}**: ${task.title} (${task.confidence})`).join("\n") || "- No migration tasks were generated."}
`;
}

function renderTasks(tasks: MigrationTask[]): string {
  return `# Migration Tasks

${tasks.map((task) => `- [${task.status === "passed" ? "x" : " "}] ${task.id}: ${task.title} — ${task.status}`).join("\n") || "- No tasks."}
`;
}

function renderReport(report: MigrationReport): string {
  return `# Migration Report

Status: ${report.ok ? "passed" : "needs follow-up"}

${report.summary}

## Verifiers

${report.verifierResults.map((result) => `- ${result.ok ? "PASS" : "FAIL"} ${result.id}: ${result.summary}`).join("\n") || "- No verifiers configured."}
`;
}

function touch<T extends { updatedAt: string }>(value: T): T {
  value.updatedAt = new Date().toISOString();
  return value;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
