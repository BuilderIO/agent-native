import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import type {
  AttemptIdentity,
  CellRunReceipt,
  RunEvent,
  RunReceipt,
} from "../../../shared/notebook-execution.js";
import type { KernelVariable } from "../../../shared/notebook-kernel-output.js";
import type {
  AuthorizedResultRef,
  ResultField,
  ResultManifest,
} from "../../../shared/notebook-result-contract.js";
import type { ProviderDiagnostic } from "../../execution/notebook-diagnostics.js";
import type { StoredPlan } from "./planner.js";

export const notebookRuns = pgTable("analytics2_notebook_runs", {
  id: text("id").$type<RunReceipt["runId"]>().primaryKey(),
  namespaceId: text("namespace_id").notNull(),
  orgId: text("org_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  caller: text("caller").notNull(),
  requestId: text("request_id").notNull(),
  intent: text("intent").notNull(),
  receipt: jsonb("receipt").$type<RunReceipt>().notNull(),
  plan: jsonb("plan").$type<StoredPlan>().notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull().default(0n),
});

export const notebookProposalRunIntents = pgTable(
  "analytics2_notebook_proposal_run_intents",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    bindingId: text("binding_id").notNull(),
    threadId: text("thread_id").notNull(),
    projectId: text("project_id").notNull(),
    versionId: text("version_id").notNull(),
    orgId: text("org_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    kind: text("kind", { enum: ["thread", "draft"] }).notNull(),
    overlayRevision: text("overlay_revision").notNull(),
    cellIds: jsonb("cell_ids").$type<string[]>().notNull(),
    allowCandidateReuse: boolean("allow_candidate_reuse").notNull(),
    snapshot: jsonb("snapshot").$type<RunReceipt["request"]["snapshot"]>(),
    runId: text("run_id").$type<RunReceipt["runId"]>(),
    outcome: text("outcome"),
  },
);

export const notebookRunAttempts = pgTable("analytics2_notebook_run_attempts", {
  id: text("id").$type<AttemptIdentity["attemptId"]>().primaryKey(),
  runId: text("run_id").notNull(),
  receipt: jsonb("receipt").$type<CellRunReceipt>().notNull(),
  diagnostic: jsonb("diagnostic").$type<RunDiagnostic>(),
  kernelPresentation: jsonb("kernel_presentation").$type<KernelPresentation>(),
  terminal: boolean("terminal").notNull().default(false),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const notebookReactiveInputs = pgTable(
  "analytics2_notebook_reactive_inputs",
  {
    projectId: text("project_id").primaryKey(),
    versionId: text("version_id").notNull(),
    inputCellIds: jsonb("input_cell_ids")
      .$type<AttemptIdentity["cellId"][]>()
      .notNull(),
  },
);

export type RunDiagnostic = {
  code: string;
  message?: string;
  provider?: ProviderDiagnostic;
  fallbackCode?: string;
  fallbackProvider?: ProviderDiagnostic;
  dispatch?: {
    compiledSql?: string;
    sql?: string;
    fingerprint: string;
    parameters: { name: string; type: string }[];
  };
};

export const notebookRunEvents = pgTable("analytics2_notebook_run_events", {
  runId: text("run_id").notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  event: jsonb("event").$type<RunEvent>().notNull(),
});

export type SourceAuthority = { connectionId: string; generation: string };

export type KernelPresentation = {
  generation: string | null;
  output: PrivateBlobHandle | null;
  authorities: SourceAuthority[];
  exports: Array<
    KernelVariable & { resultId?: AuthorizedResultRef["resultId"] }
  >;
};

export type KernelVariableState = {
  variables: KernelVariable[];
  authorities: SourceAuthority[];
};

export type ResultBuild = {
  result: AuthorizedResultRef;
  authorities: SourceAuthority[];
  artifactId: string;
  transport?: "storage" | "rest";
  fallbackCode?: string;
  fallbackProvider?: ProviderDiagnostic;
  kernelContext?: string;
};

export type ResultCheckpoint = {
  cursor: string | null;
  rowCount: number;
  totalRows: string | null;
  schemaFingerprint: string;
  fields: ResultField[];
};

export const notebookRunWork = pgTable("analytics2_notebook_run_work", {
  submissionId: text("submission_id").primaryKey(),
  runId: text("run_id").$type<AttemptIdentity["runId"]>().notNull(),
  cellId: text("cell_id").$type<AttemptIdentity["cellId"]>().notNull(),
  ordinal: integer("ordinal").notNull(),
  attemptId: text("attempt_id").$type<AttemptIdentity["attemptId"]>().notNull(),
  generation: text("generation")
    .$type<AttemptIdentity["outputGeneration"]>()
    .notNull(),
  leaseUntil: bigint("lease_until", { mode: "number" }),
  operationFingerprint: text("operation_fingerprint"),
  checkpoint: jsonb("checkpoint").$type<ResultCheckpoint>(),
  resultId: text("result_id").$type<AuthorizedResultRef["resultId"]>(),
  resultBuild: jsonb("result_build").$type<ResultBuild>(),
  providerJob: jsonb("provider_job").$type<{
    projectId: string;
    jobId: string;
    location: string;
  }>(),
  dispatched: boolean("dispatched").notNull().default(false),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  done: boolean("done").notNull().default(false),
});

export const notebookOutputs = pgTable("analytics2_notebook_outputs", {
  namespaceId: text("namespace_id").notNull(),
  cellId: text("cell_id").$type<AttemptIdentity["cellId"]>().notNull(),
  generation: text("generation")
    .$type<AttemptIdentity["outputGeneration"]>()
    .notNull(),
  attemptId: text("attempt_id").$type<AttemptIdentity["attemptId"]>(),
  resultId: text("result_id").$type<ResultManifest["result"]["resultId"]>(),
  signature: text("signature"),
  dependencyResultId: text("dependency_result_id").$type<
    ResultManifest["result"]["resultId"]
  >(),
  dependencySignature: text("dependency_signature"),
});

export const notebookResultManifests = pgTable(
  "analytics2_notebook_result_manifests",
  {
    id: text("id").$type<ResultManifest["result"]["resultId"]>().primaryKey(),
    manifest: jsonb("manifest").$type<ResultManifest>().notNull(),
    artifacts: jsonb("artifacts").$type<PrivateBlobHandle[]>().notNull(),
    artifactId: text("artifact_id"),
    authorities: jsonb("authorities").$type<SourceAuthority[]>(),
    bindings: jsonb("bindings").$type<AuthorizedResultRef[]>(),
    cacheKey: text("cache_key"),
    createdAt: bigint("created_at", { mode: "number" }),
  },
);

export const notebookResultSegments = pgTable(
  "analytics2_notebook_result_segments",
  {
    artifactId: text("artifact_id").notNull(),
    startRow: integer("start_row").notNull(),
    rowCount: integer("row_count").notNull(),
    handle: jsonb("handle").$type<PrivateBlobHandle>().notNull(),
    checksum: text("checksum").notNull(),
    submissionId: text("submission_id").notNull(),
    verified: boolean("verified").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.startRow] })],
);

export const notebookResultViews = pgTable("analytics2_notebook_result_views", {
  viewKey: text("view_key").primaryKey(),
  page: integer("page").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
});

export const notebookResultViewReceipts = pgTable(
  "analytics2_notebook_result_view_receipts",
  {
    viewKey: text("view_key").notNull(),
    requestId: text("request_id").notNull(),
    intent: text("intent").notNull(),
    resultId: text("result_id")
      .$type<AuthorizedResultRef["resultId"]>()
      .notNull(),
    page: integer("page").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.viewKey, table.requestId] })],
);
