import { and, eq, isNull } from "@agent-native/core/db/schema";

import {
  withoutPendingCellEdit,
  type Cell,
  type ProjectDocument,
} from "../../app/lib/model/contracts.js";
import { draftAppLayout, pruneAppLayout } from "../../shared/app-layout.js";
import { revisionSchema } from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import { readAppDocument, writeAppDocument } from "./app-layouts.js";
import { insertCellRows, readCells } from "./cells-store.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { MAX_NOTEBOOK_CELLS } from "./notebook-execution/snapshot.js";
import { lockNotebookProject } from "./notebook-operations/store.js";
import {
  assertAuthorizedProject,
  ProjectAccessError,
} from "./project-access.js";
import {
  ensureWorkingProjectDraft,
  latestVersionNumber,
  readLockedDraftDocument,
  type ProjectScope,
} from "./projects-store.js";
import { requireWorkspaceScope } from "./scope.js";

const { projects, projectVersions } = schema;

export async function seedLegacyPublishedProject(
  scopeInput: ProjectScope,
  projectId: string,
  versionName?: string,
): Promise<ProjectDocument> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);

  await ensureWorkingProjectDraft(scope, projectId);
  return getDb().transaction(async (tx) => {
    const existing = await lockNotebookProject(scope, projectId, tx, "update");
    if (existing.ownerEmail !== scope.ownerEmail)
      throw new ProjectAccessError();
    const timestamp = nowIso();
    const versionId = newId("ver");
    const number = String((await latestVersionNumber(projectId, tx)) + 1);
    const workingCells: Cell[] = await readCells(
      scope,
      projectId,
      existing.workingVersionId,
      tx,
    );

    const cellIds = new Set(workingCells.map((cell) => cell.id));
    const currentOutputs = await tx
      .select()
      .from(schema.cellOutputs)
      .where(
        and(
          eq(schema.cellOutputs.projectId, projectId),
          isNull(schema.cellOutputs.undo),
        ),
      )
      .limit(MAX_NOTEBOOK_CELLS);
    const capturedOutputs = currentOutputs.filter((output) =>
      cellIds.has(output.cellId),
    );

    await tx.insert(projectVersions).values({
      id: versionId,
      projectId,
      number,
      kind: "published",
      name: versionName ?? null,
      capturedOutputCount: capturedOutputs.length,
      createdAt: timestamp,
      createdBy: scope.ownerEmail,
    });
    await insertCellRows(
      {
        scope,
        projectId,
        versionId,
        cells: workingCells.map((cell) =>
          withoutPendingCellEdit(cell.contents),
        ),
        at: timestamp,
      },
      tx,
    );
    const workingLayout = await readAppDocument(
      tx,
      scope.orgId,
      projectId,
      existing.workingVersionId,
    );
    const releaseLayout = workingLayout
      ? pruneAppLayout(workingLayout, workingCells)
      : draftAppLayout(workingCells, revisionSchema.parse("0"));
    await writeAppDocument(
      tx,
      scope.orgId,
      projectId,
      versionId,
      releaseLayout,
    );
    if (capturedOutputs.length)
      await tx.insert(schema.publishedCellOutputs).values(
        capturedOutputs.map(
          ({
            cellId,
            sourceConnectionId,
            connectionProvenanceRecorded,
            status,
            output,
            ranAt,
          }) => ({
            versionId,
            projectId,
            cellId,
            sourceConnectionId,
            connectionProvenanceRecorded,
            status,
            output,
            ranAt,
          }),
        ),
      );
    await tx
      .update(projects)
      .set({
        publishedVersionId: versionId,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
          eq(projects.id, projectId),
        ),
      );

    const row = await assertAuthorizedProject(scope, projectId, tx);
    return readLockedDraftDocument(row, scope, tx);
  });
}
