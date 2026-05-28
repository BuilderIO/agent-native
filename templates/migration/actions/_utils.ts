import fs from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { resolveAccess } from "@agent-native/core/sharing";
import type {
  MigrationPlanInputs,
  MigrationRun,
  MigrationTask,
  ProjectIR,
  VerifierResult,
} from "@agent-native/migrate";
import {
  normalizeMigrationPlanInputs,
  parseMigrationPlanInputsText,
} from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";

export function artifactRoot() {
  return path.resolve(process.cwd(), "data", "migration-runs");
}

export function normalizePath(value: string) {
  return path.resolve(process.cwd(), value);
}

export function assertSafeOutputRoot(sourceRoot: string, outputRoot: string) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  if (output === source || output.startsWith(`${source}${path.sep}`)) {
    throw new Error(
      "Output directory must be outside the source project so migration never mutates source code.",
    );
  }
}

export async function getRunRow(id: string) {
  const access = await resolveAccess("migration-run", id);
  if (!access) throw new Error(`Migration run ${id} not found`);
  return access.resource as typeof schema.migrationRuns.$inferSelect;
}

export function rowToRun(
  row: typeof schema.migrationRuns.$inferSelect,
): MigrationRun {
  return {
    id: row.id,
    sourceRoot: row.sourceRoot,
    inputKind: row.inputKind,
    inputDescription: row.inputDescription,
    outputRoot: row.outputRoot,
    target: row.target,
    phase: row.phase as MigrationRun["phase"],
    approved: row.approved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    artifactDir: row.artifactDir,
    ir: row.irJson ? (JSON.parse(row.irJson) as ProjectIR) : undefined,
  };
}

export function parsePlanInputsJson(
  value: string | null | undefined,
): MigrationPlanInputs | null {
  return parsePlanInputsJsonWithDiagnostics(value).planInputs;
}

export interface PlanInputsParseResult {
  planInputs: MigrationPlanInputs | null;
  planInputsText: string;
  planInputsParseError?: string;
}

export function parsePlanInputsJsonWithDiagnostics(
  value: string | null | undefined,
): PlanInputsParseResult {
  if (!value) return { planInputs: null, planInputsText: "" };
  try {
    const planInputs = normalizeMigrationPlanInputs(JSON.parse(value));
    if (!planInputs) {
      return {
        planInputs: null,
        planInputsText: value,
        planInputsParseError:
          "Saved plan inputs do not match the supported migration profile schema.",
      };
    }
    return {
      planInputs,
      planInputsText: JSON.stringify(planInputs, null, 2),
    };
  } catch {
    return {
      planInputs: null,
      planInputsText: value,
      planInputsParseError:
        "Saved plan inputs are not valid JSON. Review or replace them before saving.",
    };
  }
}

export function serializePlanInputs(value: unknown): string | null {
  const normalized = normalizeMigrationPlanInputs(value);
  return normalized ? JSON.stringify(normalized, null, 2) : null;
}

export function resolvePlanInputsUpdate(input: {
  planInputs?: unknown;
  planInputsText?: string;
}): MigrationPlanInputs | null {
  const hasPlanInputs = input.planInputs !== undefined;
  const hasPlanInputsText = input.planInputsText !== undefined;
  const trimmedText =
    typeof input.planInputsText === "string" ? input.planInputsText.trim() : "";

  if (!hasPlanInputs && !hasPlanInputsText) {
    throw new Error(
      "Provide planInputsText or planInputs. Pass planInputs: null to clear saved plan inputs.",
    );
  }
  if (hasPlanInputsText && trimmedText && hasPlanInputs) {
    throw new Error("Provide either planInputsText or planInputs, not both.");
  }
  if (hasPlanInputsText && trimmedText) {
    const parsed = parseMigrationPlanInputsText(
      input.planInputsText ?? "",
      "Workbench plan inputs",
    );
    if (!parsed) {
      throw new Error(
        "Plan input text could not be converted into a supported migration profile.",
      );
    }
    return parsed;
  }
  if (hasPlanInputs) {
    if (input.planInputs === null) return null;
    const normalized = normalizeMigrationPlanInputs(input.planInputs);
    if (!normalized) {
      throw new Error(
        "planInputs must match the supported migration profile schema.",
      );
    }
    return normalized;
  }
  throw new Error(
    "Plan input text is empty. Pass planInputs: null to clear it.",
  );
}

export interface AssessmentSourceMetadata {
  source: string;
  sourceLabel: string;
  needsAgentIntrospection: boolean;
  inputKind?: string;
  inputDescription?: string;
}

export function assessmentSourceMetadata(
  ir: ProjectIR | null | undefined,
): AssessmentSourceMetadata | null {
  if (!ir) return null;
  const metadata = ir.site.metadata ?? {};
  const source =
    stringMetadata(metadata.source) ??
    (ir.site.framework === "unknown" ? "unknown" : ir.site.framework);
  const needsAgentIntrospection =
    metadata.needsAgentIntrospection === true ||
    source === "agent-introspection";
  return {
    source,
    sourceLabel: needsAgentIntrospection
      ? "Agent introspection skeleton"
      : sourceLabel(source),
    needsAgentIntrospection,
    inputKind: stringMetadata(metadata.inputKind),
    inputDescription: stringMetadata(metadata.inputDescription),
  };
}

export async function loadTasks(runId: string): Promise<MigrationTask[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.migrationTasks)
    .where(eq(schema.migrationTasks.runId, runId));
  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    recipeName: row.recipeName,
    title: row.title,
    status: row.status as MigrationTask["status"],
    confidence: row.confidence as MigrationTask["confidence"],
    targetIds: JSON.parse(row.targetIds) as string[],
    summary: row.summary,
    updatedAt: row.updatedAt,
  }));
}

export async function replaceTasks(runId: string, tasks: MigrationTask[]) {
  const db = getDb();
  await db
    .delete(schema.migrationTasks)
    .where(eq(schema.migrationTasks.runId, runId));
  if (tasks.length === 0) return;
  await db.insert(schema.migrationTasks).values(
    tasks.map((task) => ({
      id: task.id,
      runId,
      recipeName: task.recipeName,
      title: task.title,
      status: task.status,
      confidence: task.confidence,
      targetIds: JSON.stringify(task.targetIds),
      summary: task.summary,
      updatedAt: task.updatedAt,
    })),
  );
}

export async function replaceVerifierResults(
  runId: string,
  results: VerifierResult[],
) {
  const db = getDb();
  await db
    .delete(schema.migrationVerifierResults)
    .where(eq(schema.migrationVerifierResults.runId, runId));
  const now = new Date().toISOString();
  if (results.length === 0) return;
  await db.insert(schema.migrationVerifierResults).values(
    results.map((result) => ({
      id: `${runId}-${result.id}`,
      runId,
      verifierId: result.id,
      ok: result.ok,
      severity: result.severity,
      summary: result.summary,
      artifactPaths: JSON.stringify(result.artifactPaths),
      suggestedNextTask: result.suggestedNextTask ?? null,
      createdAt: now,
    })),
  );
}

export async function ensureSeedDirectory() {
  await fs.mkdir(path.resolve(process.cwd(), "data"), { recursive: true });
}

function stringMetadata(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sourceLabel(source: string) {
  if (source === "nextjs") return "Next.js";
  if (source === "unknown") return "Unknown source";
  return source;
}
