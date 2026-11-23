import { isActionContractError } from "@agent-native/core/action";
import { and, desc, eq, lt, or } from "drizzle-orm";

import {
  cellContentsSchema,
  type Cell,
  type ChartSpec,
} from "../../app/lib/model/contracts.js";
import { compareOrder } from "../../app/lib/model/order.js";
import { bindDefaultChartAxes } from "../../shared/chart-visualization-config.js";
import {
  appSessionIdSchema,
  resultIdSchema,
} from "../../shared/notebook-execution.js";
import {
  completeResultManifestSchema,
  resultFieldSchema,
  type CompleteResultManifest,
} from "../../shared/notebook-result-contract.js";
import { notebookCellIdSchema } from "../../shared/notebook-snapshot-contract.js";
import type { VisualizationFailure } from "../../shared/visualization-contracts.js";
import { getDb, schema } from "../db/index.js";
import { readKernelExports } from "../execution/notebook-kernel-result.js";
import { decodeJsonColumn } from "./json-column.js";
import { digest, notebookGraph } from "./notebook-execution/planner.js";
import { notebookOutputs } from "./notebook-execution/schema.js";
import {
  draftNamespace,
  type ExecutionActor,
} from "./notebook-execution/snapshot.js";
import { threadNamespace } from "./notebook-execution/thread-snapshot.js";
import {
  loadNotebookResult,
  streamLoadedNotebookResult,
} from "./notebook-results.js";
import {
  getAuthorizedProjectRow,
  getReadableProjectRow,
} from "./project-access.js";
import {
  readPreviewManifest,
  readPublishPreview,
  readPublishPreviewSnapshot,
} from "./publish-previews.js";
import { publishedSessionOutputNamespace } from "./published-app-sessions.js";

const { cells, projectVersions, projectReleases, releaseManifestOutputs } =
  schema;
const producerLimit = 16;

type Candidate = {
  cellId: string;
  contents: Cell["contents"] | null;
  resultId: string | null;
};

type Target = {
  projectId: string;
  cellId: string;
  releaseId?: string | undefined;
  sessionId?: string | undefined;
  previewId?: string | undefined;
};
export type ProducerBinding = { cellId: string; exportId: string };

function visualizationFields({ fields, result }: CompleteResultManifest) {
  return fields.map((field) =>
    resultFieldSchema.parse({
      ...field,
      fieldId: digest([result.producer.exportId, field.name, field.type]),
    }),
  );
}

export async function bindChartResult(
  actor: ExecutionActor,
  notebook: { projectId: string; versionId: string; cells: readonly Cell[] },
  binding: ProducerBinding,
  spec: ChartSpec,
  thread: { id: string; threadId: string },
): Promise<ChartSpec> {
  const { projectId, versionId, cells } = notebook;
  const { cellId, exportId } = binding;

  async function read(namespaceId: string, threadId?: string) {
    const [pointer] = await getDb()
      .select({
        resultId: notebookOutputs.resultId,
        signature: notebookOutputs.signature,
      })
      .from(notebookOutputs)
      .where(
        and(
          eq(notebookOutputs.namespaceId, namespaceId),
          eq(notebookOutputs.cellId, notebookCellIdSchema.parse(cellId)),
        ),
      )
      .limit(1);
    if (!pointer?.resultId) return;
    if (!threadId) {
      const node = notebookGraph(
        cells.flatMap(({ id, contents }) =>
          contents.kind === "sql" ||
          contents.kind === "code" ||
          contents.kind === "input"
            ? [{ id: notebookCellIdSchema.parse(id), contents }]
            : [],
        ),
      ).find(({ cell }) => cell.id === cellId);
      if (!node || pointer.signature !== node.signature) return;
    }
    const loaded = await loadNotebookResult(
      actor,
      pointer.resultId,
      threadId ? { threadId } : undefined,
    );
    if (loaded.status !== "found") return;
    const { manifest } = loaded;
    if (manifest.status !== "complete" && manifest.status !== "complete-empty")
      return;
    const { result } = manifest;
    if (
      result.snapshot.projectId !== projectId ||
      result.snapshot.head.versionId !== versionId ||
      result.producer.cellId !== cellId ||
      result.producer.exportId !== exportId
    )
      return;
    const fields = visualizationFields(manifest);
    if (new Set(fields.map(({ fieldId }) => fieldId)).size === fields.length)
      return fields;
  }

  const candidate = await read(
    threadNamespace(actor, thread.id, thread.threadId).namespaceId,
    thread.threadId,
  );
  const fields =
    candidate ?? (await read(draftNamespace(actor, projectId).namespaceId));
  const bound: ChartSpec = {
    ...spec,
    version: 3,
    revision: spec.revision ?? 0,
    sourceCellId: cellId,
    sourceExportId: exportId,
  };
  return fields
    ? bindDefaultChartAxes(bound, fields)
    : { ...bound, autoBind: true };
}

export const stale = { status: "stale", reason: "result_superseded" } as const;
export const unreadable = {
  status: "unreadable",
  reason: "result_unreadable",
} as const;
export const denied = {
  status: "denied",
  reason: "result_source_denied",
} as const;
export const conflict = {
  status: "stale",
  reason: "notebook_conflict",
} as const;
export const invalid = {
  status: "blocked",
  reason: "visualization_binding_invalid",
} as const;
export const unconfigured = { status: "unconfigured" } as const;

async function readVisualizationPreview(
  actor: ExecutionActor,
  target: Target & { previewId: string },
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { projectId, previewId } = target;
    const preview = await readPublishPreview(
      tx,
      actor,
      projectId,
      previewId,
      "share",
    );
    const access = await readPublishPreviewSnapshot(
      actor,
      preview.snapshot,
      tx,
    );
    if (access.status !== "accepted")
      return access.status === "unreadable" ? unreadable : denied;
    const cell = preview.project.cells.find(({ id }) => id === target.cellId);
    if (!cell) return stale;
    const { contents, updatedAt, versionId } = cell;
    const { order } = contents;
    const { outputs } = await readPreviewManifest(tx, preview);
    const resultIds = new Map(
      outputs.flatMap(({ cellId, state, resultId }) =>
        state === "ready" && resultId ? [[cellId, resultId] as const] : [],
      ),
    );
    const candidates = preview.project.cells
      .filter(
        (upstream) =>
          compareOrder(upstream.contents.order, order) < 0 &&
          (upstream.contents.kind === "sql" ||
            upstream.contents.kind === "code"),
      )
      .sort((first, second) =>
        compareOrder(second.contents.order, first.contents.order),
      )
      .map(({ id, contents }) => ({
        cellId: id,
        contents,
        resultId: resultIds.get(id) ?? null,
      }));
    return {
      target,
      versionId,
      contents,
      updatedAt,
      order,
      configDigest: digest(contents),
      source: { kind: "preview", candidates } as const,
    };
  });
}

export async function readVisualizationCell(
  actor: ExecutionActor,
  target: Target,
) {
  if (target.previewId) {
    if (target.releaseId || target.sessionId) return denied;
    try {
      return await readVisualizationPreview(actor, {
        ...target,
        previewId: target.previewId,
      });
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.errorCode === "preview_not_found"
      )
        return denied;
      throw error;
    }
  }
  const { projectId, releaseId, sessionId, cellId } = target;
  if (sessionId && !releaseId) return denied;
  const project = sessionId
    ? undefined
    : await (releaseId ? getReadableProjectRow : getAuthorizedProjectRow)(
        actor,
        projectId,
      );
  if (!sessionId && (!project || project.trashedAt)) return denied;
  const versionId = releaseId ?? project?.workingVersionId;
  if (!versionId) return denied;
  const namespaceId = sessionId
    ? await publishedSessionOutputNamespace(actor, {
        projectId,
        releaseId: versionId,
        sessionId,
        cellId,
      })
    : draftNamespace(actor, projectId).namespaceId;
  if (!namespaceId) return denied;
  const db = getDb();
  let manifestId: string | null = null;
  if (releaseId) {
    const [version] = await db
      .select({ manifestId: projectReleases.manifestId })
      .from(projectVersions)
      .leftJoin(
        projectReleases,
        and(
          eq(projectReleases.id, projectVersions.id),
          eq(projectReleases.orgId, actor.orgId),
          eq(projectReleases.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.id, versionId),
          eq(projectVersions.kind, "published"),
        ),
      )
      .limit(1);
    if (!version) return denied;
    manifestId = version.manifestId;
  }
  const [cell] = await db
    .select({
      contents: cells.contents,
      order: cells.order,
      updatedAt: cells.updatedAt,
    })
    .from(cells)
    .where(
      and(
        eq(cells.projectId, projectId),
        eq(cells.versionId, versionId),
        eq(cells.id, cellId),
      ),
    )
    .limit(1);
  if (!cell) return stale;
  const contents = decodeJsonColumn(cell.contents, cellContentsSchema);
  if (!contents) return unreadable;
  return {
    target,
    versionId,
    contents,
    updatedAt: cell.updatedAt,
    order: cell.order,
    configDigest: digest(contents),
    source:
      releaseId && !sessionId
        ? ({ kind: "release", manifestId } as const)
        : ({ kind: "namespace", namespaceId } as const),
  };
}
export type VisualizationCell = Exclude<
  Awaited<ReturnType<typeof readVisualizationCell>>,
  { status: string }
>;

async function producerCandidates(
  view: VisualizationCell,
  selection?: { cellId: string } | { name: string },
): Promise<Candidate[]> {
  const { source } = view;
  const byId =
    selection && "cellId" in selection ? selection.cellId : undefined;
  if (source.kind === "preview") {
    if (byId) return source.candidates.filter(({ cellId }) => cellId === byId);
    return selection
      ? source.candidates
      : source.candidates.slice(0, producerLimit);
  }
  const db = getDb();
  const { target, versionId } = view;
  const pointer =
    source.kind === "release" ? releaseManifestOutputs : notebookOutputs;
  const pointerMatch =
    source.kind === "release"
      ? source.manifestId !== null &&
        and(
          eq(releaseManifestOutputs.manifestId, source.manifestId),
          eq(releaseManifestOutputs.cellId, cells.id),
          eq(releaseManifestOutputs.state, "ready"),
        )
      : and(
          eq(notebookOutputs.namespaceId, source.namespaceId),
          eq(notebookOutputs.cellId, cells.id),
        );
  if (!pointerMatch) return [];
  const candidates = db
    .select({
      cellId: cells.id,
      contents: cells.contents,
      resultId: pointer.resultId,
    })
    .from(cells);
  const rows = await candidates
    .leftJoin(pointer, pointerMatch)
    .where(
      and(
        eq(cells.projectId, target.projectId),
        eq(cells.versionId, versionId),
        lt(cells.order, view.order),
        or(eq(cells.kind, "sql"), eq(cells.kind, "code")),
        byId ? eq(cells.id, byId) : undefined,
      ),
    )
    .orderBy(desc(cells.order))
    .limit(byId ? 1 : selection ? 501 : producerLimit);
  return rows.map(({ contents, ...row }) => ({
    ...row,
    contents: decodeJsonColumn(contents, cellContentsSchema),
  }));
}

function producerName(candidate: Candidate) {
  const { contents } = candidate;
  return contents?.kind === "sql" || contents?.kind === "code"
    ? contents.resultVariable
    : null;
}

function loadVisualizationResult(
  actor: ExecutionActor,
  view: VisualizationCell,
  id: string,
) {
  const { projectId, releaseId, sessionId, previewId } = view.target;
  return loadNotebookResult(
    actor,
    resultIdSchema.parse(id),
    sessionId
      ? {
          sessionId: appSessionIdSchema.parse(sessionId),
          ...(view.contents.kind === "metric" && view.contents.metricConfig
            ? { visualizationCellId: view.target.cellId }
            : {}),
        }
      : previewId
        ? { previewId }
        : releaseId
          ? { publishedRelease: { projectId, releaseId } }
          : undefined,
  );
}

type VisualizationResultRead = Awaited<
  ReturnType<typeof loadVisualizationResult>
>;

async function namedExports(value: VisualizationResultRead) {
  return value.status === "found"
    ? (
        await readKernelExports(value.manifest.result.producer.attemptId)
      ).flatMap(({ kind, name, resultId }) =>
        kind === "dataframe" && resultId
          ? [{ name, resultId, exportId: `symbol:${name}` }]
          : [],
      )
    : [];
}

type NamedExport = Awaited<ReturnType<typeof namedExports>>[number];

async function loadProducer(
  actor: ExecutionActor,
  view: VisualizationCell,
  candidate: Candidate,
  binding?: ProducerBinding,
  prepared?: { primary: VisualizationResultRead; exported?: NamedExport },
) {
  if (!candidate.resultId) return stale;
  let value =
    prepared?.primary ??
    (await loadVisualizationResult(actor, view, candidate.resultId));
  let name = producerName(candidate) ?? candidate.cellId;
  if (
    candidate.contents?.kind === "code" &&
    value.status === "found" &&
    binding &&
    binding.exportId !== value.manifest.result.producer.exportId
  ) {
    const exported =
      prepared?.exported ??
      (await namedExports(value)).find(
        ({ exportId }) => exportId === binding.exportId,
      );
    if (!exported) return stale;
    value = await loadVisualizationResult(actor, view, exported.resultId);
    name = exported.name;
  }
  if (value.status === "denied") return denied;
  if (value.status === "absent") return stale;
  if (value.status === "unreadable") return unreadable;
  if (
    value.status === "building" ||
    value.manifest.status === "pending" ||
    value.manifest.status === "incomplete"
  )
    return { status: "blocked", reason: "result_incomplete" } as const;
  const manifest = completeResultManifestSchema.parse(value.manifest);
  const { result } = manifest;
  const { producer, snapshot } = result;
  if (
    snapshot.projectId !== view.target.projectId ||
    producer.cellId !== candidate.cellId ||
    (binding && binding.exportId !== producer.exportId)
  )
    return stale;
  if (!value.row.artifactId)
    return { status: "blocked", reason: "result_incomplete" } as const;
  const rowCount = Number(manifest.rowCount);
  if (!Number.isSafeInteger(rowCount))
    return { status: "blocked", reason: "result_limit" } as const;
  const fields = visualizationFields(manifest);
  if (new Set(fields.map(({ fieldId }) => fieldId)).size !== fields.length)
    return invalid;
  return {
    manifest,
    rowCount,
    fields,
    option: {
      binding: {
        cellId: producer.cellId,
        exportId: producer.exportId,
        resultId: result.resultId,
      },
      name,
      fields,
    },
    stream: () => streamLoadedNotebookResult(value),
  };
}
export type VisualizationProducer = Exclude<
  Awaited<ReturnType<typeof loadProducer>>,
  { status: string }
>;

export async function resolveVisualizationProducer(
  actor: ExecutionActor,
  view: VisualizationCell,
  binding: ProducerBinding | { name: string } | null,
  list = true,
) {
  const selected = binding ? await producerCandidates(view, binding) : [];
  const matches =
    binding && "name" in binding
      ? selected.filter((candidate) => producerName(candidate) === binding.name)
      : selected;
  const exact = matches.length === 1 ? matches[0] : undefined;
  const resolved: VisualizationProducer | VisualizationFailure = exact
    ? await loadProducer(
        actor,
        view,
        exact,
        binding && "cellId" in binding ? binding : undefined,
      )
    : binding
      ? matches.length
        ? invalid
        : stale
      : unconfigured;
  const candidates =
    list && !view.target.releaseId ? await producerCandidates(view) : [];
  const sources: VisualizationProducer["option"][] = [];
  if ("option" in resolved) sources.push(resolved.option);
  for (const candidate of candidates) {
    if (!candidate.resultId) continue;
    const primary = await loadVisualizationResult(
      actor,
      view,
      candidate.resultId,
    );
    const exports =
      candidate.contents?.kind === "code" ? await namedExports(primary) : [];
    if (candidate.cellId !== exact?.cellId) {
      const producer = await loadProducer(actor, view, candidate, undefined, {
        primary,
      });
      if ("option" in producer) sources.push(producer.option);
    }
    for (const exported of exports) {
      const { exportId } = exported;
      if (
        "option" in resolved &&
        resolved.option.binding.cellId === candidate.cellId &&
        resolved.option.binding.exportId === exportId
      )
        continue;
      const producer = await loadProducer(
        actor,
        view,
        candidate,
        {
          cellId: candidate.cellId,
          exportId,
        },
        { primary, exported },
      );
      if ("option" in producer) sources.push(producer.option);
    }
  }
  return { resolved, sources };
}
