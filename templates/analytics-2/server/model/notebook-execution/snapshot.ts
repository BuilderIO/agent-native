import { and, eq } from "@agent-native/core/db/schema";

import {
  cellContentsSchema,
  type CellContents,
} from "../../../app/lib/model/contracts.js";
import { compareOrder } from "../../../app/lib/model/order.js";
import {
  executionSnapshotSchema,
  namespaceIdSchema,
  type RunSectionCell,
  type Snapshot,
} from "../../../shared/notebook-execution.js";
import {
  notebookCellIdSchema,
  revisionSchema,
  type Revision,
} from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import { decodeJsonColumn, StoredDataError } from "../json-column.js";
import { canEditProject, projectAccessLevel } from "../project-grant-access.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import { digest, executionContents, type ExecutionCell } from "./planner.js";

export const MAX_NOTEBOOK_CELLS = 500;

export type ExecutionActor = WorkspaceScope & { caller: string };
type SnapshotCells = {
  cells: ExecutionCell[];
  sectionCells?: RunSectionCell[];
};
export type AcceptedSnapshot = SnapshotCells & { snapshot: Snapshot };
export type SnapshotLoad =
  | { status: "accepted"; value: AcceptedSnapshot; settings?: DraftRunSettings }
  | { status: "absent" | "denied" | "unreadable" | "pending" };

export type SnapshotReader = (
  actor: ExecutionActor,
  requested: Snapshot,
  tx?: Queryable,
) => Promise<SnapshotLoad>;

export function executionSnapshotCells(
  rows: readonly { id: string; contents: CellContents }[],
): SnapshotCells {
  const cells: ExecutionCell[] = [];
  const sectionCells: RunSectionCell[] = [];
  for (const { id, contents } of rows) {
    if (
      contents.kind === "sql" ||
      contents.kind === "code" ||
      contents.kind === "input"
    ) {
      cells.push({ id: notebookCellIdSchema.parse(id), contents });
    } else if (contents.kind === "collapsible") {
      const { kind, collapsed, parentSectionId } = contents;
      sectionCells.push({ id, contents: { kind, collapsed, parentSectionId } });
    }
  }
  return { cells, ...(sectionCells.length ? { sectionCells } : {}) };
}

export function executionFingerprint({ cells, sectionCells }: SnapshotCells) {
  const contents = cells.map(({ id, contents }) => [
    id,
    executionContents(contents),
  ]);
  return digest(
    sectionCells
      ? [
          contents,
          [...sectionCells, ...cells].map(({ id, contents }) => [
            id,
            contents.parentSectionId ?? null,
          ]),
        ]
      : contents,
  );
}

export function draftNamespace(actor: WorkspaceScope, projectId: string) {
  return {
    kind: "draft",
    namespaceId: namespaceIdSchema.parse(
      digest(["draft", actor.orgId, projectId]),
    ),
  } as const;
}

export async function readDraftSnapshot(
  actor: ExecutionActor,
  requested: Snapshot,
  tx?: Queryable,
): Promise<SnapshotLoad> {
  if (requested.ref.workspaceId !== actor.orgId) return { status: "denied" };
  if (requested.namespace.kind !== "draft") return { status: "pending" };
  const { projectId } = requested.ref;
  const namespace = draftNamespace(actor, projectId);
  if (namespace.namespaceId !== requested.namespace.namespaceId)
    return { status: "denied" };
  return readCurrentDraftSnapshot(actor, projectId, tx);
}

export async function readCurrentDraftSnapshot(
  actor: WorkspaceScope,
  projectId: string,
  tx?: Queryable,
  lock: "share" | "update" = "update",
): Promise<
  | { status: "accepted"; value: AcceptedSnapshot; settings: DraftRunSettings }
  | { status: "absent" | "unreadable" }
> {
  const db = tx ?? getDb();
  const projectQuery = db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.orgId, actor.orgId),
      ),
    )
    .limit(1);
  const [project] = await (tx ? projectQuery.for(lock) : projectQuery);
  if (!project || project.trashedAt) return { status: "absent" };
  if (!canEditProject(await projectAccessLevel(actor, project, [], db)))
    return { status: "absent" };
  const rows = await db
    .select()
    .from(schema.cells)
    .where(
      and(
        eq(schema.cells.projectId, projectId),
        eq(schema.cells.versionId, project.workingVersionId),
      ),
    )
    .limit(MAX_NOTEBOOK_CELLS + 1);
  if (rows.length > MAX_NOTEBOOK_CELLS) return { status: "unreadable" };
  const notebook: { id: string; contents: CellContents }[] = [];
  for (const row of rows) {
    let contents;
    try {
      contents = decodeJsonColumn(row.contents, cellContentsSchema);
    } catch (error) {
      if (!(error instanceof StoredDataError)) throw error;
      return { status: "unreadable" };
    }
    if (!contents) return { status: "unreadable" };
    notebook.push({ id: row.id, contents });
  }
  notebook.sort((a, b) => compareOrder(a.contents.order, b.contents.order));
  const cells = executionSnapshotCells(notebook);
  return {
    status: "accepted",
    value: {
      snapshot: executionSnapshotSchema.parse({
        ref: {
          workspaceId: actor.orgId,
          projectId,
          head: {
            versionId: project.workingVersionId,
            revision: project.notebookRevision.toString(),
          },
          eventSeq: project.notebookEventSeq.toString(),
        },
        namespace: draftNamespace(actor, projectId),
        inputRevision: project.notebookInputRevision.toString(),
        executionFingerprint: executionFingerprint(cells),
      }),
      ...cells,
    },
    settings: {
      defaultMode: project.notebookDefaultRunMode,
      autoRerun: project.notebookAutoRerun,
      settingsRevision: revisionSchema.parse(
        project.notebookRunSettingsRevision.toString(),
      ),
    },
  };
}

type DraftRunSettings = {
  defaultMode: (typeof schema.projects.$inferSelect)["notebookDefaultRunMode"];
  autoRerun: boolean;
  settingsRevision: Revision;
};
