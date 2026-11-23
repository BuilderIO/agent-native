import { fail, isActionContractError } from "@agent-native/core/action";
import {
  deletePrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  appSessionIdSchema,
  attemptIdSchema,
  resultIdSchema,
  runIdSchema,
  type Snapshot,
} from "../../shared/notebook-execution.js";
import { kernelOutputSchema } from "../../shared/notebook-kernel-output.js";
import {
  completeResultManifestSchema,
  resultFieldSchema,
  resultManifestSchema,
  type AuthorizedResultRef,
  type CompleteResultManifest,
  type ResultField,
} from "../../shared/notebook-result-contract.js";
import {
  absentSchema,
  deniedSchema,
  revisionSchema,
  unreadableSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  decodeNotebookArrow,
  kernelInputBytes,
  kernelInputTable,
  MAX_KERNEL_ARROW_BYTES,
  MAX_RESULT_SEGMENTS,
  notebookArrowValue,
  readNotebookSegment,
  RESULT_SEGMENT_ROWS,
} from "../execution/notebook-arrow.js";
import {
  providerDiagnosticSchema,
  runFailureMessageSchema,
} from "../execution/notebook-diagnostics.js";
import { readKernelOutputs } from "../execution/notebook-kernel-result.js";
import { sqlSource } from "../execution/source-resolver.js";
import { withWarehouseSource } from "../execution/warehouse-connector.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { resultPreviewSchema } from "./cell-result-preview.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  digest,
  notebookGraph,
  selectionGraph,
} from "./notebook-execution/planner.js";
import {
  notebookOutputs as outputs,
  notebookResultManifests as manifests,
  notebookResultSegments as segments,
  notebookResultViewReceipts as receipts,
  notebookResultViews as views,
  notebookRunAttempts as attempts,
  notebookRuns as runs,
  notebookRunWork as work,
  type SourceAuthority,
} from "./notebook-execution/schema.js";
import type { ExecutionActor } from "./notebook-execution/snapshot.js";
import { readRunThread } from "./notebook-execution/thread-snapshot.js";
import { getReadableProjectRow } from "./project-access.js";
import { canEditProject, projectAccessLevel } from "./project-grant-access.js";
import { readPublishPreviewSnapshot } from "./publish-previews.js";
import {
  authorizePublishedResult,
  readPublishedExecutionSnapshot,
} from "./published-app-sessions.js";
import { visualizationResults } from "./visualization-schema.js";

const PAGE_ROWS = 50;
const MAX_LEGACY_SEGMENTS = 8;
const CACHE_TTL_MS = 15 * 60_000;
const STAGING_TTL_MS = 60 * 60_000;
const absent = absentSchema.parse({ status: "absent", reason: "not_found" });
const denied = deniedSchema.parse({
  status: "denied",
  reason: "access_denied",
});
const unreadable = unreadableSchema.parse({
  status: "unreadable",
  reason: "read_failed",
});
const readFailures = [absentSchema, deniedSchema, unreadableSchema] as const;
const pageNumber = z.int().min(1).max(2_147_483_647);
const rowScalar = z.union([
  z.json(),
  z.strictObject({
    type: z.enum(["integer", "decimal", "binary"]),
    value: z.string(),
  }),
]);
const viewSchema = z.strictObject({
  page: pageNumber,
  viewRevision: revisionSchema,
});

export const getNotebookResultPageInput = z.strictObject({
  resultId: resultIdSchema,
  page: pageNumber.optional(),
  sessionId: appSessionIdSchema.optional(),
  previewId: z.string().min(1).optional(),
  threadId: z.string().min(1).max(128).optional(),
});
export const getNotebookResultPageOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    manifest: resultManifestSchema,
    page: pageNumber,
    rows: z.array(z.array(rowScalar)).max(PAGE_ROWS),
    view: viewSchema,
    pythonOutputs: z.array(kernelOutputSchema).max(512).optional(),
    preview: resultPreviewSchema.optional(),
  }),
  z.strictObject({
    status: z.literal("pending"),
    resultId: resultIdSchema,
    page: pageNumber,
  }),
  z.strictObject({
    status: z.literal("incomplete"),
    resultId: resultIdSchema,
    page: pageNumber,
    knownRows: z.string(),
    reason: z.enum(["truncated", "sampled", "coverage_unverified"]),
  }),
  z.strictObject({
    status: z.literal("out_of_range"),
    resultId: resultIdSchema,
    lastPage: pageNumber,
  }),
  ...readFailures,
]);

export const openPublishedResultDrillInput = z.strictObject({
  resultId: resultIdSchema,
  sessionId: appSessionIdSchema,
  page: pageNumber.default(1),
  filters: z
    .array(
      z.strictObject({
        fieldId: resultFieldSchema.shape.fieldId,
        value: rowScalar,
      }),
    )
    .min(1)
    .max(3),
});

export const openPublishedResultDrillOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    resultId: resultIdSchema,
    fields: z.array(resultFieldSchema),
    rows: z.array(z.array(rowScalar)).max(PAGE_ROWS),
    totalRows: z.int().nonnegative(),
    page: pageNumber,
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["incomplete", "invalid_field", "result_limit"]),
  }),
  ...readFailures,
]);

export const setNotebookResultViewInput = z.strictObject({
  resultId: resultIdSchema,
  threadId: getNotebookResultPageInput.shape.threadId,
  page: pageNumber,
  requestId: z.uuid(),
  expectedViewRevision: revisionSchema,
});
export const setNotebookResultViewOutput = z.discriminatedUnion("status", [
  viewSchema.extend({ status: z.literal("saved"), resultId: resultIdSchema }),
  z.strictObject({
    status: z.literal("conflict"),
    reason: z.enum(["stale_result", "view_changed", "request_reused"]),
  }),
  ...readFailures,
]);

type ResultId = z.infer<typeof resultIdSchema>;
type StoredResult = typeof manifests.$inferSelect;
type ResultScope = Pick<
  z.infer<typeof getNotebookResultPageInput>,
  "sessionId" | "previewId" | "threadId"
> & {
  releaseDefault?: Snapshot;
  publishedRelease?: { projectId: string; releaseId: string };
  choiceFields?: { valueFieldId: string; displayFieldId: string | undefined };
  visualizationCellId?: string;
};

export async function currentResultActor(
  caller: string,
): Promise<ExecutionActor> {
  await ensureAnalyticsDatabase();
  const { orgId, ownerEmail } = await requireCurrentWorkspace();
  return { orgId, ownerEmail, caller };
}

function actorScope(actor: ExecutionActor) {
  return and(
    eq(runs.orgId, actor.orgId),
    eq(runs.ownerEmail, actor.ownerEmail),
  );
}

export async function checkNotebookAuthorities(
  actor: ExecutionActor,
  authorities: SourceAuthority[],
) {
  for (const { connectionId, generation } of authorities) {
    try {
      const current = await withWarehouseSource(
        connectionId,
        actor,
        async (source) => source.generation,
      );
      if (current !== generation) return denied;
    } catch (error) {
      if (isActionContractError(error) && error.statusCode < 500) return denied;
      return unreadable;
    }
  }
  return null;
}

export async function readNotebookResultAuthorities(
  dependencies: CompleteResultManifest[],
) {
  const expected = new Map(
    dependencies.map((manifest) => [manifest.result.resultId, manifest]),
  );
  const ids = [...expected.keys()];
  if (!ids.length) return [];
  const rows = await getDb()
    .select()
    .from(manifests)
    .where(inArray(manifests.id, ids))
    .limit(ids.length);
  if (rows.length !== ids.length)
    throw new Error("Notebook dependency provenance is missing");
  const authorities = new Map<string, SourceAuthority>();
  for (const row of rows) {
    if (
      row.manifest.status !== "complete" &&
      row.manifest.status !== "complete-empty"
    )
      fail("The dataframe is incomplete. Run the source cell again.", {
        statusCode: 409,
        errorCode: "dataframe_incomplete",
      });
    if (digest(row.manifest) !== digest(expected.get(row.id)))
      fail("The dataframe result has changed. Run the source cell again.", {
        statusCode: 409,
        errorCode: "dataframe_stale",
      });
    if (
      row.authorities === null &&
      (row.manifest.result.sourceGeneration !== null ||
        row.manifest.result.kernelGeneration !== null)
    )
      throw new Error("Notebook dependency provenance is unreadable");
    for (const authority of row.authorities ?? [])
      authorities.set(
        `${authority.connectionId}:${authority.generation}`,
        authority,
      );
  }
  return [...authorities.values()].sort(
    (a, b) =>
      a.connectionId.localeCompare(b.connectionId) ||
      a.generation.localeCompare(b.generation),
  );
}

async function authorizeProject(
  actor: ExecutionActor,
  run: typeof runs.$inferSelect,
  threadId?: string,
  cellId?: string,
) {
  const request = run.receipt.request;
  const { snapshot } = request;
  if (snapshot.ref.workspaceId !== actor.orgId) return denied;
  if (snapshot.namespace.kind === "draft") {
    const project = await getReadableProjectRow(actor, snapshot.ref.projectId);
    return project &&
      !project.trashedAt &&
      canEditProject(await projectAccessLevel(actor, project))
      ? null
      : absent;
  }
  if (snapshot.namespace.kind === "thread") {
    const latest = await readRunThread(actor, snapshot, threadId);
    const signature = run.plan.cells.find(
      ({ cell }) => cell.id === cellId,
    )?.signature;
    if (
      !latest ||
      !signature ||
      latest.snapshot.inputRevision !== snapshot.inputRevision
    )
      return denied;
    const graph =
      run.plan.selection && request.mode !== "run-all"
        ? selectionGraph(latest.cells, request.targetCellId, run.plan.selection)
        : notebookGraph(latest.cells);
    return graph?.some(
      ({ cell, signature: current }) =>
        cell.id === cellId && current === signature,
    )
      ? null
      : denied;
  }
  if (
    snapshot.namespace.kind !== "release-session" ||
    String(snapshot.namespace.namespaceId) !==
      String(snapshot.namespace.sessionId) ||
    String(snapshot.namespace.releaseId) !== snapshot.ref.head.versionId
  )
    return denied;
  const project = await getReadableProjectRow(actor, snapshot.ref.projectId);
  if (!project || project.trashedAt) return absent;
  const [version] = await getDb()
    .select({ id: schema.projectVersions.id })
    .from(schema.projectVersions)
    .where(
      and(
        eq(schema.projectVersions.id, snapshot.namespace.releaseId),
        eq(schema.projectVersions.projectId, project.id),
        eq(schema.projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  return version ? null : absent;
}

async function authorizeReleaseResult(
  actor: ExecutionActor,
  run: typeof runs.$inferSelect,
  resultId: ResultId,
  { projectId, releaseId }: NonNullable<ResultScope["publishedRelease"]>,
) {
  const { snapshot } = run.receipt.request;
  if (
    (snapshot.namespace.kind !== "preview" &&
      snapshot.namespace.kind !== "draft") ||
    snapshot.ref.workspaceId !== actor.orgId ||
    snapshot.ref.projectId !== projectId
  )
    return denied;
  const project = await getReadableProjectRow(actor, projectId);
  if (!project || project.trashedAt) return absent;
  const { projectReleases: releases, releaseManifestOutputs: releaseOutputs } =
    schema;
  const [entry] = await getDb()
    .select({ id: releases.id })
    .from(releases)
    .innerJoin(
      releaseOutputs,
      eq(releaseOutputs.manifestId, releases.manifestId),
    )
    .where(
      and(
        eq(releases.id, releaseId),
        eq(releases.orgId, actor.orgId),
        eq(releases.projectId, projectId),
        eq(releaseOutputs.resultId, resultId),
        eq(releaseOutputs.state, "ready"),
      ),
    )
    .limit(1);
  return entry ? null : absent;
}

export function primaryResultId(
  resultId: ResultId,
  producer?: AuthorizedResultRef["producer"],
) {
  if (!producer) return resultId;
  const { exportId, ...attempt } = producer;
  return exportId.startsWith("symbol:") || exportId.startsWith("display:")
    ? resultIdSchema.parse(digest(attempt))
    : resultId;
}

async function authorizePinnedPreview(
  actor: ExecutionActor,
  draft: Snapshot,
  previewId: string,
  pinnedId: ResultId,
) {
  const { publishPreviews } = schema;
  const [preview] = await getDb()
    .select({ snapshot: publishPreviews.snapshot })
    .from(publishPreviews)
    .where(
      and(
        eq(publishPreviews.id, previewId),
        eq(publishPreviews.orgId, actor.orgId),
        eq(publishPreviews.projectId, draft.ref.projectId),
        eq(publishPreviews.actorId, actor.ownerEmail),
      ),
    )
    .limit(1);
  if (!preview) return denied;
  const checked = await readPublishPreviewSnapshot(actor, preview.snapshot);
  if (checked.status !== "accepted")
    return checked.status === "unreadable" ? unreadable : denied;
  const [pointer] = await getDb()
    .select({ cellId: outputs.cellId })
    .from(outputs)
    .where(
      and(
        eq(outputs.namespaceId, preview.snapshot.namespace.namespaceId),
        eq(outputs.resultId, pinnedId),
        isNull(outputs.attemptId),
      ),
    )
    .limit(1);
  return pointer ? null : denied;
}

async function authorizeResult(
  actor: ExecutionActor,
  run: typeof runs.$inferSelect,
  resultId: ResultId,
  {
    sessionId,
    previewId,
    threadId,
    releaseDefault,
    publishedRelease,
    choiceFields,
    visualizationCellId,
  }: ResultScope,
  producer?: AuthorizedResultRef["producer"],
  cellId = producer?.cellId,
) {
  const { snapshot } = run.receipt.request;
  if (publishedRelease)
    return sessionId || previewId || threadId || releaseDefault
      ? denied
      : authorizeReleaseResult(
          actor,
          run,
          primaryResultId(resultId, producer),
          publishedRelease,
        );
  if (snapshot.namespace.kind === "thread") {
    if (sessionId || previewId || releaseDefault) return denied;
    return authorizeProject(actor, run, threadId, cellId);
  }
  if (sessionId && previewId) return denied;
  if (sessionId)
    return authorizePublishedResult(
      actor,
      run,
      resultId,
      sessionId,
      producer,
      choiceFields,
      visualizationCellId,
    );
  if (releaseDefault) {
    if (
      snapshot.namespace.kind !== "release-default" ||
      snapshot.namespace.namespaceId !== releaseDefault.namespace.namespaceId
    )
      return denied;
    const release = await readPublishedExecutionSnapshot(actor, releaseDefault);
    if (release.status === "accepted") return null;
    return release.status === "unreadable" ? unreadable : absent;
  }
  if (!previewId && snapshot.namespace.kind === "schedule-tick") {
    const { readAuthorizedScheduleTick } =
      await import("./published-app-schedules.js");
    return (await readAuthorizedScheduleTick(actor, snapshot)) ? null : denied;
  }
  if (!previewId) return authorizeProject(actor, run);
  if (
    run.ownerEmail === actor.ownerEmail &&
    snapshot.namespace.kind === "draft"
  )
    return authorizePinnedPreview(
      actor,
      snapshot,
      previewId,
      primaryResultId(resultId, producer),
    );
  if (
    run.ownerEmail !== actor.ownerEmail ||
    snapshot.namespace.kind !== "preview" ||
    snapshot.namespace.previewId !== previewId
  )
    return denied;
  const preview = await readPublishPreviewSnapshot(actor, snapshot);
  if (preview.status === "accepted") return null;
  if (preview.status === "unreadable") return unreadable;
  return absent;
}

export async function loadNotebookResult(
  actor: ExecutionActor,
  resultId: ResultId,
  scope: ResultScope = {},
): Promise<
  | typeof absent
  | typeof denied
  | typeof unreadable
  | { status: "building" }
  | {
      status: "found";
      row: StoredResult;
      manifest: z.infer<typeof resultManifestSchema>;
      viewKey: string;
      pythonDisplay: boolean;
      pythonPrimary: boolean;
    }
> {
  const db = getDb();
  const producerScope =
    scope.sessionId || scope.publishedRelease
      ? eq(runs.orgId, actor.orgId)
      : actorScope(actor);
  const [saved] = await db
    .select({ row: manifests, run: runs })
    .from(manifests)
    .innerJoin(
      runs,
      eq(runs.id, sql`${manifests.manifest}->'result'->'producer'->>'runId'`),
    )
    .where(and(eq(manifests.id, resultId), producerScope))
    .limit(1);
  if (saved) {
    const manifest = resultManifestSchema.safeParse(saved.row.manifest);
    const failure = await authorizeResult(
      actor,
      saved.run,
      resultId,
      scope,
      manifest.data?.result.producer,
    );
    if (failure) return failure;
    if (!manifest.success || manifest.data.result.resultId !== resultId)
      return unreadable;
    let authorities = saved.row.authorities;
    if (authorities === null) {
      const { producer, sourceGeneration, kernelGeneration } =
        manifest.data.result;
      if (kernelGeneration !== null) return unreadable;
      authorities = [];
      if (sourceGeneration !== null) {
        const contents = saved.run.plan.cells.find(
          ({ cell }) => cell.id === producer.cellId,
        )?.cell.contents;
        const source = contents?.kind === "sql" ? sqlSource(contents) : null;
        if (source?.kind !== "warehouse") return unreadable;
        authorities.push({
          connectionId: source.id,
          generation: sourceGeneration,
        });
      }
    }
    const authorityFailure = await checkNotebookAuthorities(actor, authorities);
    if (authorityFailure) return authorityFailure;
    const producer = manifest.data.result.producer;
    const { provenance, kernelGeneration } = manifest.data.result;
    const python =
      (provenance === "browser" || kernelGeneration !== null) &&
      saved.run.plan.cells.some(
        ({ cell }) =>
          cell.id === producer.cellId && cell.contents.kind === "code",
      );
    const pythonDisplay = python && producer.exportId.startsWith("display:");
    const viewKey = digest([
      actor.orgId,
      actor.ownerEmail,
      ...(scope.sessionId ? [scope.sessionId] : []),
      producer.namespaceId,
      manifest.data.result.snapshot.projectId,
      producer.cellId,
      ...(saved.run.plan.selection || pythonDisplay ? [resultId] : []),
    ]);
    return {
      status: "found",
      row: saved.row,
      manifest: manifest.data,
      viewKey,
      pythonDisplay,
      pythonPrimary: python && primaryResultId(resultId, producer) === resultId,
    } as const;
  }
  if (scope.publishedRelease) return absent;
  const [building] = await db
    .select({ row: work, run: runs })
    .from(work)
    .innerJoin(runs, eq(runs.id, work.runId))
    .where(
      and(eq(work.resultId, resultId), eq(work.done, false), producerScope),
    )
    .limit(1);
  if (!building) {
    const [promoted] = await db
      .select({ id: manifests.id })
      .from(manifests)
      .innerJoin(
        runs,
        eq(runs.id, sql`${manifests.manifest}->'result'->'producer'->>'runId'`),
      )
      .where(and(eq(manifests.id, resultId), producerScope))
      .limit(1);
    return promoted ? loadNotebookResult(actor, resultId, scope) : absent;
  }
  const failure = await authorizeResult(
    actor,
    building.run,
    resultId,
    scope,
    building.row.resultBuild?.result.producer,
    building.row.cellId,
  );
  if (failure) return failure;
  if (!building.row.resultBuild) return unreadable;
  if (
    building.row.resultBuild.result.producer.attemptId !==
    building.row.attemptId
  )
    return absent;
  return (
    (await checkNotebookAuthorities(
      actor,
      building.row.resultBuild.authorities,
    )) ?? ({ status: "building" } as const)
  );
}

export async function findCachedNotebookResult(key: string, versionId: string) {
  const [row] = await getDb()
    .select()
    .from(manifests)
    .where(
      and(
        eq(manifests.cacheKey, key),
        sql`${manifests.manifest}->'result'->'snapshot'->'head'->>'versionId' = ${versionId}`,
        gte(manifests.createdAt, Date.now() - CACHE_TTL_MS),
      ),
    )
    .orderBy(desc(manifests.createdAt))
    .limit(1);
  if (!row?.artifactId) return null;
  const manifest = completeResultManifestSchema.safeParse(row.manifest);
  if (!manifest.success)
    throw new Error("Cached notebook result is unreadable");
  return {
    artifactId: row.artifactId,
    manifest: manifest.data,
    createdAt: row.createdAt,
  };
}

function resultScalar(value: unknown, field: ResultField) {
  if (value === null) return null;
  if (field.type === "integer" && typeof value === "bigint")
    return { type: field.type, value: String(value) };
  if (field.type === "decimal" && typeof value === "string")
    return { type: field.type, value };
  if (field.type === "binary" && value instanceof Uint8Array)
    return { type: field.type, value: Buffer.from(value).toString("base64") };
  if (
    (field.type === "list" ||
      field.type === "struct" ||
      field.type === "json") &&
    typeof value === "string"
  )
    return z.json().parse(JSON.parse(value));
  return z.json().parse(value);
}

async function readRows(
  row: StoredResult,
  fields: ResultField[],
  start: number,
  end: number,
) {
  const result: z.infer<typeof rowScalar>[][] = [];
  const preserveDecimalScale = row.manifest.result.kernelGeneration !== null;
  let next = start;
  let pageCharacters = 0;
  function append(
    table: ReturnType<typeof decodeNotebookArrow>,
    offset: number,
  ) {
    if (offset > next) throw new Error("Notebook result index has a gap");
    const columns = fields.map((field, index) => {
      const vector = table.getChildAt(index);
      if (!vector) throw new Error("Notebook result is missing a column");
      return { field, vector };
    });
    for (; next < end && next < offset + table.numRows; next++) {
      const row = columns.map(({ field, vector }) =>
        resultScalar(
          notebookArrowValue(vector, next - offset, preserveDecimalScale),
          field,
        ),
      );
      pageCharacters += JSON.stringify(row).length + 1;
      if (pageCharacters > 1_000_000)
        throw new Error("Notebook result page is too large");
      result.push(row);
    }
  }
  if (row.artifactId) {
    const indexed = await getDb()
      .select()
      .from(segments)
      .where(
        and(
          eq(segments.artifactId, row.artifactId),
          gte(segments.startRow, Math.max(0, start - RESULT_SEGMENT_ROWS + 1)),
          lt(segments.startRow, end),
          sql`${segments.startRow} + ${segments.rowCount} > ${start}`,
          eq(segments.verified, true),
        ),
      )
      .orderBy(asc(segments.startRow))
      .limit(PAGE_ROWS);
    for (const segment of indexed)
      append(
        (await readNotebookSegment(segment, fields)).table,
        segment.startRow,
      );
  } else {
    let offset = 0;
    for (const handle of row.artifacts.slice(0, MAX_LEGACY_SEGMENTS)) {
      const { data } = await readPrivateBlob(handle);
      const table = decodeNotebookArrow(data, fields);
      if (next < offset + table.numRows) append(table, offset);
      offset += table.numRows;
      if (next === end) break;
    }
  }
  if (next !== end)
    throw new Error("Notebook result page is missing indexed rows");
  return result;
}

export async function* streamLoadedNotebookResult(
  value: Awaited<ReturnType<typeof loadNotebookResult>>,
) {
  if (value.status !== "found" || !value.row.artifactId)
    throw new Error("Notebook input is not an authorized artifact");
  const manifest = completeResultManifestSchema.parse(value.manifest);
  let start = 0;
  const rowCount = BigInt(manifest.rowCount);
  while (BigInt(start) < rowCount) {
    const [segment] = await getDb()
      .select()
      .from(segments)
      .where(
        and(
          eq(segments.artifactId, value.row.artifactId),
          eq(segments.startRow, start),
          eq(segments.verified, true),
        ),
      )
      .limit(1);
    if (
      !segment ||
      segment.rowCount < 1 ||
      BigInt(start + segment.rowCount) > rowCount
    )
      throw new Error("Notebook input segment coverage is unreadable");
    const { data } = await readNotebookSegment(segment, manifest.fields);
    start += segment.rowCount;
    yield data;
  }
}

export async function readNotebookKernelInput(
  actor: ExecutionActor,
  expected: CompleteResultManifest,
  scope?: ResultScope,
) {
  const value = await loadNotebookResult(
    actor,
    expected.result.resultId,
    scope,
  );
  if (value.status === "denied" || value.status === "absent")
    fail("You don’t have access to a source used by this dataframe.", {
      statusCode: 403,
      errorCode: "dataframe_denied",
    });
  if (value.status === "unreadable")
    fail("The dataframe could not be read.", {
      statusCode: 503,
      errorCode: "dataframe_unreadable",
    });
  if (
    value.status !== "found" ||
    (value.manifest.status !== "complete" &&
      value.manifest.status !== "complete-empty")
  )
    fail("The dataframe is incomplete. Run the source cell again.", {
      statusCode: 409,
      errorCode: "dataframe_incomplete",
    });
  const { manifest, row } = value;
  if (digest(expected) !== digest(manifest))
    fail("The dataframe result has changed. Run the source cell again.", {
      statusCode: 409,
      errorCode: "dataframe_stale",
    });
  const tables: ReturnType<typeof decodeNotebookArrow>[] = [];
  const artifactId = row.artifactId;
  if (!artifactId && manifest.status !== "complete-empty")
    fail("The dataframe is incomplete. Run the source cell again.", {
      statusCode: 409,
      errorCode: "dataframe_incomplete",
    });
  const indexed = artifactId
    ? await getDb()
        .select()
        .from(segments)
        .where(eq(segments.artifactId, artifactId))
        .orderBy(asc(segments.startRow))
        .limit(MAX_RESULT_SEGMENTS + 1)
    : [];
  try {
    let inputBytes = 0;
    let start = 0;
    for (const segment of indexed) {
      if (
        !segment.verified ||
        segment.startRow !== start ||
        segment.rowCount < 1 ||
        tables.length >= MAX_RESULT_SEGMENTS
      )
        throw new Error("Notebook input segment coverage is unreadable");
      const { data, table } = await readNotebookSegment(
        segment,
        manifest.fields,
      );
      inputBytes += data.byteLength;
      if (inputBytes > MAX_KERNEL_ARROW_BYTES)
        throw new Error("Notebook input exceeds the kernel Arrow limit");
      start += segment.rowCount;
      tables.push(kernelInputTable(table, manifest.fields));
    }
    if (String(start) !== manifest.rowCount)
      throw new Error("Notebook input coverage differs from its manifest");
    const { sourceGeneration, kernelGeneration } = manifest.result;
    return kernelInputBytes(
      tables,
      manifest.fields,
      sourceGeneration === null && kernelGeneration === null,
    );
  } catch {
    fail("The dataframe could not be read.", {
      statusCode: 503,
      errorCode: "dataframe_unreadable",
    });
  }
}

function lastResultPage(rows: string) {
  const pages = (BigInt(rows) + BigInt(PAGE_ROWS - 1)) / BigInt(PAGE_ROWS);
  return pageNumber.parse(pages === 0n ? 1 : Number(pages));
}

export async function getNotebookResultPage(
  actor: ExecutionActor,
  { resultId, page, ...scope }: z.infer<typeof getNotebookResultPageInput>,
): Promise<z.infer<typeof getNotebookResultPageOutput>> {
  const value = await loadNotebookResult(actor, resultId, scope);
  if (value.status === "building")
    return { status: "pending", resultId, page: page ?? 1 };
  if (value.status !== "found") return value;
  const { manifest } = value;
  if (manifest.status === "pending")
    return { status: "pending", resultId, page: page ?? 1 };
  const knownRows =
    manifest.status === "incomplete"
      ? manifest.verifiedRowCount
      : manifest.rowCount;
  const lastPage = lastResultPage(knownRows);
  const [saved] = await getDb()
    .select()
    .from(views)
    .where(eq(views.viewKey, value.viewKey))
    .limit(1);
  const view = viewSchema.parse({
    page: Math.min(saved?.page ?? 1, lastPage),
    viewRevision: String(saved?.revision ?? 0n),
  });
  const requested = page ?? view.page;
  const start = (requested - 1) * PAGE_ROWS;
  if (
    manifest.status === "incomplete" &&
    BigInt(start + PAGE_ROWS) > BigInt(knownRows)
  )
    return {
      status: "incomplete",
      resultId,
      page: requested,
      knownRows,
      reason: manifest.reason,
    };
  if (requested > lastPage)
    return { status: "out_of_range", resultId, lastPage };
  const end = Math.min(start + PAGE_ROWS, Number(knownRows));
  try {
    const rows =
      start === end
        ? []
        : await readRows(value.row, manifest.fields, start, end);
    let pythonOutputs:
      | Awaited<ReturnType<typeof readKernelOutputs>>
      | undefined;
    if (value.pythonPrimary && (scope.previewId || scope.sessionId)) {
      const [attempt] = await getDb()
        .select({ presentation: attempts.kernelPresentation })
        .from(attempts)
        .where(eq(attempts.id, manifest.result.producer.attemptId))
        .limit(1);
      if (!attempt?.presentation) return unreadable;
      pythonOutputs = await readKernelOutputs(attempt.presentation.output);
    }
    return {
      status: "ready",
      manifest,
      page: requested,
      rows,
      view,
      ...(pythonOutputs ? { pythonOutputs } : {}),
    };
  } catch {
    return unreadable;
  }
}

export async function openPublishedResultDrill(
  actor: ExecutionActor,
  {
    resultId,
    sessionId,
    filters,
    page,
  }: z.infer<typeof openPublishedResultDrillInput>,
): Promise<z.infer<typeof openPublishedResultDrillOutput>> {
  const value = await loadNotebookResult(actor, resultId, { sessionId });
  if (value.status === "building")
    return { status: "unavailable", reason: "incomplete" };
  if (value.status !== "found") return value;
  const { manifest, row } = value;
  if (manifest.status !== "complete" && manifest.status !== "complete-empty")
    return { status: "unavailable", reason: "incomplete" };
  if (BigInt(manifest.rowCount) > 10_000n)
    return { status: "unavailable", reason: "result_limit" };
  const indexes = filters.map(({ fieldId, value }) => ({
    index: manifest.fields.findIndex((field) => field.fieldId === fieldId),
    expected: digest(value),
  }));
  if (indexes.some(({ index }) => index < 0))
    return { status: "unavailable", reason: "invalid_field" };
  try {
    const data = await readRows(
      row,
      manifest.fields,
      0,
      Number(manifest.rowCount),
    );
    const matches = data.filter((record) =>
      indexes.every(
        ({ index, expected }) => digest(record[index]) === expected,
      ),
    );
    const start = (page - 1) * PAGE_ROWS;
    return {
      status: "ready",
      resultId,
      fields: manifest.fields,
      rows: matches.slice(start, start + PAGE_ROWS),
      totalRows: matches.length,
      page,
    };
  } catch {
    return unreadable;
  }
}

export async function readNotebookResultChoices(
  actor: ExecutionActor,
  resultId: ResultId,
  valueFieldId: string,
  displayFieldId?: string,
  scope?: ResultScope,
) {
  const saved = await loadNotebookResult(actor, resultId, {
    ...scope,
    choiceFields: { valueFieldId, displayFieldId },
  });
  switch (saved.status) {
    case "found":
      break;
    case "absent":
      return { status: "missing" } as const;
    case "building":
      return { status: "pending" } as const;
    case "denied":
    case "unreadable":
      return { status: saved.status };
  }
  const { manifest } = saved;
  const valueIndex = manifest.fields.findIndex(
    ({ fieldId }) => fieldId === valueFieldId,
  );
  const labelIndex =
    displayFieldId === undefined
      ? valueIndex
      : manifest.fields.findIndex(({ fieldId }) => fieldId === displayFieldId);
  if (valueIndex < 0 || labelIndex < 0)
    return { status: "unreadable" } as const;
  if (manifest.status === "complete-empty") return { status: "empty" } as const;
  if (manifest.status !== "complete" || BigInt(manifest.rowCount) > 10_000n)
    return { status: "unreadable" } as const;
  const options = new Map<string, string>();
  function optionText(value: z.infer<typeof rowScalar> | undefined) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return String(value);
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      (value.type === "integer" || value.type === "decimal") &&
      "value" in value &&
      typeof value.value === "string"
    )
      return value.value;
    return undefined;
  }
  try {
    const rows = await readRows(
      saved.row,
      manifest.fields,
      0,
      Number(manifest.rowCount),
    );
    for (const row of rows) {
      if (row[valueIndex] === null) continue;
      const value = optionText(row[valueIndex]);
      const label =
        row[labelIndex] === null ? value : optionText(row[labelIndex]);
      if (
        value === undefined ||
        label === undefined ||
        value.length > 500 ||
        label.length > 500
      )
        return { status: "unreadable" } as const;
      if (!options.has(value)) options.set(value, label);
      if (options.size > 200) return { status: "unreadable" } as const;
    }
  } catch {
    return { status: "unreadable" } as const;
  }
  if (options.size === 0) return { status: "empty" } as const;
  return {
    status: "ready",
    resultId,
    values: [...options].map(([value, label]) => ({ value, label })),
  } as const;
}

export async function setNotebookResultView(
  actor: ExecutionActor,
  input: z.infer<typeof setNotebookResultViewInput>,
): Promise<z.infer<typeof setNotebookResultViewOutput>> {
  const value = await loadNotebookResult(actor, input.resultId, {
    threadId: input.threadId,
  });
  if (value.status === "building")
    return { status: "conflict", reason: "stale_result" };
  if (value.status !== "found") return value;
  const { manifest, viewKey, pythonDisplay } = value;
  if (manifest.status === "pending")
    return { status: "conflict", reason: "stale_result" };
  const knownRows =
    manifest.status === "incomplete"
      ? manifest.verifiedRowCount
      : manifest.rowCount;
  const page = Math.min(input.page, lastResultPage(knownRows));
  const intent = digest([
    input.resultId,
    input.page,
    input.expectedViewRevision,
  ]);
  const response = (row: {
    resultId: ResultId;
    page: number;
    revision: bigint;
  }) => ({
    status: "saved" as const,
    resultId: row.resultId,
    page: row.page,
    viewRevision: revisionSchema.parse(String(row.revision)),
  });
  return getDb().transaction(async (tx) => {
    const { namespaceId, cellId, attemptId, outputGeneration } =
      manifest.result.producer;
    const [pointer] = await tx
      .select()
      .from(outputs)
      .where(
        and(eq(outputs.namespaceId, namespaceId), eq(outputs.cellId, cellId)),
      )
      .limit(1)
      .for("update");
    const [replay] = await tx
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.viewKey, viewKey),
          eq(receipts.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (replay)
      return replay.intent === intent
        ? response(replay)
        : { status: "conflict", reason: "request_reused" };
    const current = pythonDisplay
      ? pointer?.attemptId === attemptId &&
        pointer.generation === outputGeneration
      : pointer?.resultId === input.resultId;
    if (!current) return { status: "conflict", reason: "stale_result" };
    await tx.insert(views).values({ viewKey, page: 1 }).onConflictDoNothing();
    const [updated] = await tx
      .update(views)
      .set({ page, revision: sql`${views.revision} + 1` })
      .where(
        and(
          eq(views.viewKey, viewKey),
          eq(views.revision, BigInt(input.expectedViewRevision)),
        ),
      )
      .returning();
    if (!updated) return { status: "conflict", reason: "view_changed" };
    const receipt = {
      viewKey,
      requestId: input.requestId,
      intent,
      resultId: input.resultId,
      page,
      revision: updated.revision,
    };
    await tx.insert(receipts).values(receipt);
    return response(receipt);
  });
}

export const getNotebookRunDiagnosticsInput = z.strictObject({
  runId: runIdSchema,
  attemptId: attemptIdSchema,
  threadId: z.string().min(1).max(128).optional(),
});

export const getNotebookRunDiagnosticsOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    traceId: z.string(),
    diagnostic: z
      .strictObject({
        code: z.string(),
        message: runFailureMessageSchema.optional(),
        provider: providerDiagnosticSchema.optional(),
        fallbackCode: z.string().optional(),
        fallbackProvider: providerDiagnosticSchema.optional(),
      })
      .nullable(),
    compiledSql: z.string().nullable(),
    parameters: z
      .array(z.strictObject({ name: z.string(), type: z.string() }))
      .max(100),
    parameterCount: z.int().nonnegative(),
  }),
  ...readFailures,
]);

export async function getNotebookRunDiagnostics(
  actor: ExecutionActor,
  {
    runId,
    attemptId,
    threadId,
  }: z.infer<typeof getNotebookRunDiagnosticsInput>,
): Promise<z.infer<typeof getNotebookRunDiagnosticsOutput>> {
  const [saved] = await getDb()
    .select({ run: runs, attempt: attempts, work })
    .from(attempts)
    .innerJoin(runs, eq(runs.id, attempts.runId))
    .leftJoin(
      work,
      and(
        eq(work.runId, runs.id),
        sql`${work.cellId} = ${attempts.receipt}->'attempt'->>'cellId'`,
      ),
    )
    .where(
      and(eq(runs.id, runId), eq(attempts.id, attemptId), actorScope(actor)),
    )
    .limit(1);
  if (!saved) return absent;
  const projectFailure = await authorizeProject(
    actor,
    saved.run,
    threadId,
    saved.attempt.receipt.attempt.cellId,
  );
  if (projectFailure) return projectFailure;
  const authorities = saved.work?.resultBuild?.authorities ?? [];
  const authorityFailure = await checkNotebookAuthorities(actor, authorities);
  if (authorityFailure) return authorityFailure;
  const node = saved.run.plan.cells.find(
    ({ cell }) => cell.id === saved.attempt.receipt.attempt.cellId,
  );
  if (!node) return unreadable;
  const source =
    node.cell.contents.kind === "sql" ? sqlSource(node.cell.contents) : null;
  const stored = saved.attempt.diagnostic;
  if (
    stored?.dispatch &&
    source?.kind === "warehouse" &&
    !authorities.some(({ connectionId }) => connectionId === source.id)
  )
    return unreadable;
  const params = stored?.dispatch?.parameters ?? [];
  const parsed = getNotebookRunDiagnosticsOutput.safeParse({
    status: "found",
    traceId: saved.work?.providerJob?.jobId ?? attemptId,
    diagnostic: stored
      ? {
          code: stored.code,
          message: stored.message,
          provider: stored.provider,
          fallbackCode: stored.fallbackCode,
          fallbackProvider: stored.fallbackProvider,
        }
      : null,
    compiledSql: stored?.dispatch?.compiledSql ?? stored?.dispatch?.sql ?? null,
    parameters: params.slice(0, 100),
    parameterCount: params.length,
  });
  return parsed.success ? parsed.data : unreadable;
}

export async function sweepNotebookResultStaging({
  deadlineAt,
  signal,
}: {
  deadlineAt: number;
  signal?: AbortSignal;
}) {
  await ensureAnalyticsDatabase();
  const db = getDb();
  const abandoned = await db
    .select({
      artifactId: segments.artifactId,
      startRow: segments.startRow,
      handle: segments.handle,
    })
    .from(segments)
    .where(
      and(
        lte(segments.createdAt, Date.now() - STAGING_TTL_MS),
        notExists(
          db
            .select({ id: manifests.id })
            .from(manifests)
            .where(eq(manifests.artifactId, segments.artifactId)),
        ),
        notExists(
          db
            .select({ id: work.submissionId })
            .from(work)
            .where(
              and(
                eq(work.submissionId, segments.submissionId),
                eq(work.done, false),
                sql`${work.resultBuild}->>'artifactId' = ${segments.artifactId}`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(segments.createdAt))
    .limit(32);
  for (const segment of abandoned) {
    if (signal?.aborted || Date.now() >= deadlineAt) return;
    const result = await deletePrivateBlob(segment.handle);
    if (!result.deleted)
      throw new Error("Could not reclaim an abandoned notebook result segment");
    await db
      .delete(segments)
      .where(
        and(
          eq(segments.artifactId, segment.artifactId),
          eq(segments.startRow, segment.startRow),
        ),
      );
  }
  const expiredBefore = Date.now();
  const expired = await db
    .select({ id: visualizationResults.id })
    .from(visualizationResults)
    .where(lte(visualizationResults.expiresAt, expiredBefore))
    .orderBy(asc(visualizationResults.expiresAt))
    .limit(16);
  for (const { id } of expired) {
    if (signal?.aborted || Date.now() >= deadlineAt) return;
    await db.transaction(async (tx) => {
      const [entry] = await tx
        .select({ artifact: visualizationResults.artifact })
        .from(visualizationResults)
        .where(
          and(
            eq(visualizationResults.id, id),
            lte(visualizationResults.expiresAt, expiredBefore),
          ),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!entry) return;
      if (!(await deletePrivateBlob(entry.artifact)).deleted)
        throw new Error("Could not reclaim an expired notebook visualization");
      await tx
        .delete(visualizationResults)
        .where(eq(visualizationResults.id, id));
    });
  }
}
