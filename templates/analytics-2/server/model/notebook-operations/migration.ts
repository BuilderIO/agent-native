import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, eq, inArray } from "@agent-native/core/db/schema";

import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { lockNotebookRunOutputs } from "../notebook-execution/run-store.js";
import { draftNamespace } from "../notebook-execution/snapshot.js";
import { assertEditableProject } from "../project-access.js";
import { forkLegacyPublishedVersion } from "../projects-store.js";
import {
  lockCellOutputForEdit,
  reserveCellOutputGeneration,
} from "../runs-store.js";
import type { WorkspaceScope } from "../scope.js";
import {
  lockNotebookProject,
  notebookBusy,
  notebookUnavailable,
  projectScopeFilter,
  projectSnapshot,
  readNotebookCells,
} from "./store.js";

class AdoptionChanged extends Error {}

export async function adoptNotebook(scope: WorkspaceScope, projectId: string) {
  await ensureAnalyticsDatabase();
  for (let attempt = 0; attempt < 8; attempt++) {
    const initial = await assertEditableProject(scope, projectId);
    if (initial.trashedAt !== null) notebookUnavailable();
    if (initial.notebookVersionId === initial.workingVersionId) {
      return getDb().transaction(async (tx) => {
        const project = await lockNotebookProject(
          scope,
          projectId,
          tx,
          "share",
        );
        if (project.notebookVersionId !== project.workingVersionId)
          return notebookBusy();
        return projectSnapshot(scope, project, tx);
      });
    }
    const ids = (await readNotebookCells(initial, getDb()))
      .map((cell) => cell.id)
      .sort();
    try {
      return await getDb().transaction(async (tx) => {
        for (const cellId of ids)
          await lockCellOutputForEdit(projectId, cellId, tx);
        await lockNotebookRunOutputs(
          tx,
          draftNamespace(scope, projectId).namespaceId,
          ids.map((id) => notebookCellIdSchema.parse(id)),
          true,
        );
        let project = await lockNotebookProject(scope, projectId, tx, "update");
        if (project.notebookVersionId === project.workingVersionId) {
          return projectSnapshot(scope, project, tx);
        }
        const currentCells = await readNotebookCells(project, tx);
        const currentIds = currentCells.map((cell) => cell.id).sort();
        if (
          initial.workingVersionId !== project.workingVersionId ||
          !isDeepStrictEqual(ids, currentIds)
        ) {
          throw new AdoptionChanged();
        }
        project = await forkLegacyPublishedVersion(
          scope,
          project,
          currentCells,
          ids,
          tx,
        );
        if (project.notebookVersionId === project.workingVersionId) {
          return projectSnapshot(scope, project, tx);
        }
        for (const cellId of ids)
          await reserveCellOutputGeneration(
            projectId,
            cellId,
            randomUUID(),
            tx,
          );
        const { projects, cellOutputs } = schema;
        await tx
          .delete(cellOutputs)
          .where(
            and(
              eq(cellOutputs.projectId, projectId),
              inArray(cellOutputs.status, ["queued", "running"]),
            ),
          );
        const notebookVersionId = project.workingVersionId;
        await tx
          .update(projects)
          .set({ notebookVersionId })
          .where(projectScopeFilter(scope, projectId));
        return projectSnapshot(scope, { ...project, notebookVersionId }, tx);
      });
    } catch (error) {
      if (!(error instanceof AdoptionChanged)) throw error;
    }
  }
  return notebookBusy();
}
