import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const migrationRuns = table("migration_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceRoot: text("source_root").notNull(),
  inputKind: text("input_kind").notNull().default("path"),
  inputDescription: text("input_description").notNull().default(""),
  outputRoot: text("output_root").notNull(),
  target: text("target").notNull().default("agent-native"),
  phase: text("phase").notNull().default("discover"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  artifactDir: text("artifact_dir").notNull(),
  assessmentPath: text("assessment_path"),
  planPath: text("plan_path"),
  reportPath: text("report_path"),
  irJson: text("ir_json"),
  planInputsJson: text("plan_inputs_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const migrationTasks = table("migration_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => migrationRuns.id),
  recipeName: text("recipe_name").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"),
  confidence: text("confidence").notNull().default("medium"),
  targetIds: text("target_ids").notNull().default("[]"),
  summary: text("summary").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const migrationVerifierResults = table("migration_verifier_results", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => migrationRuns.id),
  verifierId: text("verifier_id").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull().default(false),
  severity: text("severity").notNull().default("info"),
  summary: text("summary").notNull(),
  artifactPaths: text("artifact_paths").notNull().default("[]"),
  suggestedNextTask: text("suggested_next_task"),
  createdAt: text("created_at").notNull(),
});

export const migrationArtifacts = table("migration_artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => migrationRuns.id),
  label: text("label").notNull(),
  path: text("path").notNull(),
  kind: text("kind").notNull().default("file"),
  createdAt: text("created_at").notNull(),
});

export const migrationRunShares = createSharesTable("migration_run_shares");
