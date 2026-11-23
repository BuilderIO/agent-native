import { fail } from "@agent-native/core/action";
import { and, eq, isNull } from "@agent-native/core/db/schema";
import type { z } from "zod";

import { displayRows } from "../../app/components/notebook/useNotebookResults.js";
import { withoutPendingCellEdit } from "../../app/lib/model/contracts.js";
import { draftAppLayout, pruneAppLayout } from "../../shared/app-layout.js";
import {
  executionSnapshotSchema,
  resultIdSchema,
} from "../../shared/notebook-execution.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { projectDocumentWithLayoutSchema } from "../../shared/project-document.js";
import {
  publishProjectInput,
  publishProjectReceiptSchema,
  releaseOutputSchema,
  type PublishProjectReceipt,
} from "../../shared/project-publish.js";
import { getDb, schema } from "../db/index.js";
import { readAppDocument, writeAppDocument } from "./app-layouts.js";
import { insertCellRows, readCells } from "./cells-store.js";
import { nowIso } from "./clock.js";
import { newId } from "./ids.js";
import { digest, executionContents } from "./notebook-execution/planner.js";
import { lockNotebookRunOutputs } from "./notebook-execution/run-store.js";
import type { ExecutionActor } from "./notebook-execution/snapshot.js";
import { MAX_NOTEBOOK_CELLS } from "./notebook-execution/snapshot.js";
import {
  checkNotebookAuthorities,
  getNotebookResultPage,
} from "./notebook-results.js";
import {
  captureDraftVersionOutputs,
  latestVersionNumber,
} from "./projects-store.js";
import {
  checkedPublishHead,
  executableCells,
  lockPublisherProject,
  readPreviewManifest,
  readPublishPreview,
  requireActivePreview,
  requireMatchingPublishIntent,
  unreadablePreview,
} from "./publish-previews.js";
import type { Queryable } from "./scope.js";
import { visualizationReleaseSources } from "./visualization-schema.js";

const {
  projectCollections,
  projectReleases,
  releaseManifestOutputs,
  projectVersions,
  projects,
  publishPreviews,
} = schema;

type ProjectRelease = typeof projectReleases.$inferSelect;

export function isLegacySynthesizedRelease(
  release: Pick<ProjectRelease, "id" | "requestId">,
) {
  return release.requestId === `legacy:${release.id}`;
}

export async function readProjectRelease(
  db: Queryable,
  {
    orgId,
    projectId,
    releaseId,
  }: { orgId: string; projectId: string; releaseId: string },
): Promise<ProjectRelease | null> {
  const releases = await db
    .select()
    .from(projectReleases)
    .where(
      and(
        eq(projectReleases.id, releaseId),
        eq(projectReleases.projectId, projectId),
        eq(projectReleases.orgId, orgId),
      ),
    )
    .limit(1);
  const stored = releases.at(0);
  if (stored) return stored;
  const [legacy] = await db
    .select({ version: projectVersions, project: projects })
    .from(projectVersions)
    .innerJoin(
      projects,
      and(
        eq(projects.id, projectVersions.projectId),
        eq(projects.orgId, orgId),
        isNull(projects.trashedAt),
      ),
    )
    .where(
      and(
        eq(projectVersions.id, releaseId),
        eq(projectVersions.projectId, projectId),
        eq(projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  if (!legacy) return null;
  const { version, project } = legacy;
  const releaseCells = (
    await readCells(
      { orgId, ownerEmail: project.ownerEmail },
      projectId,
      releaseId,
      db,
    )
  ).map((cell) => ({
    ...cell,
    versionId: releaseId,
    contents: withoutPendingCellEdit(cell.contents),
  }));
  const storedLayout = await readAppDocument(db, orgId, projectId, releaseId);
  const appLayout = storedLayout
    ? pruneAppLayout(storedLayout, releaseCells)
    : draftAppLayout(releaseCells, revisionSchema.parse("0"));
  const links = await db
    .select({ collectionId: projectCollections.collectionId })
    .from(projectCollections)
    .where(eq(projectCollections.projectId, projectId));
  const head = draftHeadSchema.parse({
    versionId: releaseId,
    revision: "0",
  });
  const document = projectDocumentWithLayoutSchema.parse({
    id: project.id,
    ownerEmail: project.ownerEmail,
    title: project.title,
    ...(project.untitledOrdinal == null
      ? {}
      : { untitledOrdinal: project.untitledOrdinal }),
    description: project.description,
    language: project.language,
    statusId: project.statusId ?? null,
    favorited: project.favorited,
    trashedAt: project.trashedAt ?? null,
    archivedAt: project.archivedAt ?? null,
    lastOpenedAt: project.lastOpenedAt ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    workingVersionId: project.workingVersionId,
    publishedVersionId: releaseId,
    publishedHead: head,
    cells: releaseCells,
    collectionIds: links.map((link) => link.collectionId),
    appLayout,
  });
  const snapshot = executionSnapshotSchema.parse({
    ref: {
      workspaceId: orgId,
      projectId,
      head,
      eventSeq: "0",
    },
    namespace: {
      kind: "release-default",
      releaseId,
      namespaceId: digest([
        "legacy-release-namespace",
        orgId,
        projectId,
        releaseId,
      ]),
    },
    inputRevision: "0",
    executionFingerprint: digest(
      executableCells(document).map(({ id, contents }) => [
        id,
        executionContents(contents),
      ]),
    ),
  });
  const manifestId = digest([
    "legacy-release-manifest",
    orgId,
    projectId,
    releaseId,
  ]);
  const baseHref = `/app/${encodeURIComponent(projectId)}`;
  const receipt = publishProjectReceiptSchema.parse({
    releaseId,
    releaseNumber: version.number,
    head,
    manifestId,
    publishedAt: version.createdAt,
    appHref: `${baseHref}/latest`,
    releaseHref: `${baseHref}/${encodeURIComponent(releaseId)}`,
  });
  return {
    id: releaseId,
    orgId,
    projectId,
    head,
    project: document,
    snapshot,
    manifestId,
    comparedReleaseId: null,
    description: version.name ?? null,
    publishedAt: version.createdAt,
    publisherId: version.createdBy || project.ownerEmail,
    requestId: `legacy:${releaseId}`,
    mode: "force",
    intent: digest(["legacy-release-intent", orgId, projectId, releaseId]),
    receipt,
  };
}

export async function readReleaseManifest(db: Queryable, manifestId: string) {
  const rows = await db
    .select({
      cellId: releaseManifestOutputs.cellId,
      state: releaseManifestOutputs.state,
      resultId: releaseManifestOutputs.resultId,
      diagnosticId: releaseManifestOutputs.diagnosticId,
    })
    .from(releaseManifestOutputs)
    .where(eq(releaseManifestOutputs.manifestId, manifestId))
    .limit(MAX_NOTEBOOK_CELLS + 1);
  if (rows.length > MAX_NOTEBOOK_CELLS) unreadablePreview();
  return releaseOutputSchema.array().parse(rows);
}

export async function publishCheckedPreview(
  actor: ExecutionActor,
  input: z.infer<typeof publishProjectInput>,
): Promise<PublishProjectReceipt> {
  const {
    projectId,
    previewId,
    requestId,
    expectedManifestRevision,
    description,
    mode,
  } = input;
  const db = getDb();
  const intent = digest(input);
  const previous = await replay(db);
  if (previous) return previous;
  const checked = await db.transaction(async (tx) => {
    const project = await lockPublisherProject(
      actor,
      projectId,
      tx,
      mode === "force",
    );
    const previous = await replay(tx);
    if (previous) return { receipt: previous } as const;
    checkedPublishHead(project, input);
    const preview = await checkedPreview(tx, "share");
    return { manifest: await readPreviewManifest(tx, preview) } as const;
  });
  if ("receipt" in checked) return checked.receipt;
  if (checked.manifest.cursor !== expectedManifestRevision) changedManifest();
  checkMode(checked.manifest.state, mode);
  const authorities = new Map(
    checked.manifest.authorities.map((authority) => [
      digest(authority),
      authority,
    ]),
  );
  const sourceFailure = await checkNotebookAuthorities(actor, [
    ...authorities.values(),
  ]);
  if (sourceFailure?.status === "denied")
    fail("You don’t have access to this result.", {
      statusCode: 403,
      errorCode: "result_source_denied",
    });
  if (sourceFailure) unreadablePreview();

  const manifestCellOutputs = new Map<
    string,
    {
      columns: Array<{
        name: string;
        type: "string" | "number" | "boolean" | "date" | "datetime" | "null";
      }>;
      rows: Array<Array<string | number | boolean | null>>;
      rowCount: number;
      truncated: boolean;
      totalRows?: string;
      type: "table";
    }
  >();
  for (const item of checked.manifest.outputs) {
    if (item.state !== "ready" || !item.resultId) continue;
    const page = await getNotebookResultPage(actor, {
      resultId: resultIdSchema.parse(item.resultId),
      previewId,
      page: 1,
    });
    if (page.status !== "ready") continue;
    const { manifest } = page;
    const knownRows =
      manifest.status === "complete" || manifest.status === "complete-empty"
        ? manifest.rowCount
        : manifest.verifiedRowCount;
    manifestCellOutputs.set(item.cellId, {
      type: "table",
      columns: manifest.fields.map(({ name, type }) => ({
        name,
        type:
          type === "integer" || type === "decimal"
            ? "number"
            : type === "number" ||
                type === "boolean" ||
                type === "date" ||
                type === "datetime" ||
                type === "null"
              ? type
              : "string",
      })),
      rows: displayRows(page.rows, manifest.fields),
      rowCount: Number(knownRows),
      totalRows: knownRows,
      truncated:
        manifest.status === "incomplete" ||
        BigInt(knownRows) > BigInt(page.rows.length),
    });
  }

  return db.transaction(async (tx) => {
    const candidate = await readPublishPreview(tx, actor, projectId, previewId);
    await lockNotebookRunOutputs(
      tx,
      candidate.snapshot.namespace.namespaceId,
      executableCells(candidate.project).map(({ id }) => id),
    );
    const project = await lockPublisherProject(
      actor,
      projectId,
      tx,
      mode === "force",
    );
    const previous = await replay(tx);
    if (previous) return previous;
    const head = checkedPublishHead(project, input);
    const preview = await checkedPreview(tx, "update");
    const manifest = await readPreviewManifest(tx, preview);
    if (
      manifest.cursor !== expectedManifestRevision ||
      manifest.manifestId !== checked.manifest.manifestId
    )
      changedManifest();

    const releaseId = newId("ver");
    const releaseNumber = String(
      (await latestVersionNumber(projectId, tx)) + 1,
    );
    const publishedAt = nowIso();
    const { manifestId } = manifest;
    const baseHref = `/app/${encodeURIComponent(projectId)}`;
    const receipt = {
      releaseId,
      releaseNumber,
      head,
      manifestId,
      publishedAt,
      appHref: `${baseHref}/latest`,
      releaseHref: `${baseHref}/${encodeURIComponent(releaseId)}`,
    };
    const capturedOutputs = await captureDraftVersionOutputs(
      tx,
      projectId,
      preview.project.cells.map(({ id }) => id),
    );
    const capturedIds = new Set(capturedOutputs.map(({ cellId }) => cellId));
    const cellById = new Map(
      preview.project.cells.map((cell) => [cell.id, cell]),
    );
    for (const [cellId, tableOutput] of manifestCellOutputs) {
      if (capturedIds.has(cellId)) continue;
      const cell = cellById.get(cellId);
      capturedOutputs.push({
        projectId,
        cellId,
        status: "complete",
        output: JSON.stringify(tableOutput),
        ranAt: publishedAt,
        sourceConnectionId:
          cell?.contents.kind === "sql"
            ? (cell.contents.dataConnectionId ?? null)
            : null,
        connectionProvenanceRecorded: true,
      });
    }
    await tx.insert(projectVersions).values({
      id: releaseId,
      projectId,
      number: releaseNumber,
      kind: "published",
      name: description ?? null,
      capturedOutputCount: capturedOutputs.length,
      createdAt: publishedAt,
      createdBy: actor.ownerEmail,
    });
    if (capturedOutputs.length > 0)
      await tx.insert(schema.publishedCellOutputs).values(
        capturedOutputs.map((output) => ({
          ...output,
          versionId: releaseId,
        })),
      );
    await insertCellRows(
      {
        scope: { ...actor, ownerEmail: project.ownerEmail },
        projectId,
        versionId: releaseId,
        cells: preview.project.cells.map(({ contents }) => contents),
        at: publishedAt,
      },
      tx,
    );
    const { appLayout } = preview.project;
    if (!appLayout) unreadablePreview();
    await writeAppDocument(tx, actor.orgId, projectId, releaseId, appLayout);

    const {
      draftHead: _draftHead,
      orderRevision: _orderRevision,
      ...published
    } = preview.project;
    await tx.insert(projectReleases).values({
      id: releaseId,
      orgId: actor.orgId,
      projectId,
      head,
      project: {
        ...published,
        publishedVersionId: releaseId,
        publishedHead: head,
        cells: preview.project.cells.map((cell) => ({
          ...cell,
          versionId: releaseId,
        })),
      },
      snapshot: preview.snapshot,
      manifestId,
      comparedReleaseId: input.expectedReleaseId,
      description: description ?? null,
      publishedAt,
      publisherId: actor.ownerEmail,
      requestId,
      mode,
      intent,
      receipt,
    });
    if (manifest.outputs.length > 0)
      await tx
        .insert(releaseManifestOutputs)
        .values(manifest.outputs.map((output) => ({ ...output, manifestId })));
    const visualizationSources = manifest.outputs.flatMap(
      ({ cellId, state, resultId }) =>
        state === "ready" && resultId
          ? [{ versionId: releaseId, cellId, resultId }]
          : [],
    );
    if (visualizationSources.length)
      await tx.insert(visualizationReleaseSources).values(visualizationSources);
    await tx
      .update(publishPreviews)
      .set({ publishedReleaseId: releaseId })
      .where(eq(publishPreviews.id, previewId));
    await tx
      .update(projects)
      .set({ publishedVersionId: releaseId, updatedAt: publishedAt })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, actor.orgId),
          eq(projects.ownerEmail, project.ownerEmail),
        ),
      );
    return receipt;
  });

  async function replay(tx: Queryable) {
    const [stored] = await tx
      .select()
      .from(projectReleases)
      .where(
        and(
          eq(projectReleases.orgId, actor.orgId),
          eq(projectReleases.projectId, projectId),
          eq(projectReleases.publisherId, actor.ownerEmail),
          eq(projectReleases.requestId, requestId),
        ),
      )
      .limit(1);
    if (stored) requireMatchingPublishIntent(stored.intent, intent);
    return stored?.receipt;
  }

  async function checkedPreview(tx: Queryable, lock: "share" | "update") {
    const preview = await readPublishPreview(
      tx,
      actor,
      projectId,
      previewId,
      lock,
    );
    requireActivePreview(preview);
    if (digest(preview.snapshot.ref.head) !== digest(input.expectedHead))
      fail("The notebook changed. Prepare a new preview.", {
        statusCode: 409,
        errorCode: "publish_head_changed",
      });
    if (preview.comparedReleaseId !== input.expectedReleaseId)
      fail("The published version changed. Compare with the latest release.", {
        statusCode: 409,
        errorCode: "publish_release_changed",
      });
    return preview;
  }
}

function changedManifest(): never {
  return fail("The preview results changed. Review the latest results.", {
    statusCode: 409,
    errorCode: "preview_manifest_changed",
  });
}

function checkMode(
  state: Awaited<ReturnType<typeof readPreviewManifest>>["state"],
  mode: z.infer<typeof publishProjectInput>["mode"],
) {
  if (
    (state === "ready" && mode === "ready") ||
    (state === "failed" && mode === "accept-errors")
  )
    return;
  if (mode === "force" && (state === "queued" || state === "running")) return;
  if (state === "failed")
    fail("Accept the preview errors to publish this app.", {
      statusCode: 422,
      errorCode: "publish_error_ack_required",
    });
  fail("The publish preview isn’t ready.", {
    statusCode: 422,
    errorCode: "preview_not_ready",
  });
}
