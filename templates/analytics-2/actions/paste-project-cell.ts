import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  cellContentsSchema,
  withoutPendingCellEdit,
} from "../app/lib/model/contracts.js";
import {
  assertGrantedDataConnection,
  assertGrantedMetricConnection,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireWritableProject,
  resultVariables,
  uniqueResultVariable,
} from "../server/lib/project-action-access.js";
import { addCell } from "../server/model/cells-store.js";
import { projectCells } from "../server/model/projects-store.js";

/**
 * Places a previously copied cell after another cell, keeping every field the
 * copy carried. A SQL cell keeps its data connection only while this account
 * can still use it (otherwise nothing is added); its result variable is renamed when the project already
 * has one by that name. Saved outputs are never part of a copy.
 */
export default defineAction({
  description:
    "Paste a copied notebook cell (its contents) into a project after the given cell, or at the end.",
  schema: z
    .object({
      projectId: z.string().min(1),
      afterCellId: z.string().min(1).optional(),
      contents: z.record(z.string(), z.unknown()),
    })
    .strict(),
  outputSchema: z.object({
    ...projectDocumentResultSchema.shape,
    createdCellId: z.string(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId, afterCellId, contents }) => {
    const { scope, project } = await requireWritableProject(projectId);
    const parsed = cellContentsSchema.safeParse({
      ...contents,
      id: "pasted",
      order: "pasted",
    });
    if (!parsed.success) {
      fail("The copied cell could not be read.", {
        statusCode: 400,
        errorCode: "pasted_cell_invalid",
      });
    }
    const cells = await projectCells(
      scope,
      project.id,
      project.workingVersionId,
    );
    if (afterCellId !== undefined && !cells.some((c) => c.id === afterCellId)) {
      fail("That cell is not in this project.", {
        statusCode: 404,
        errorCode: "cell_not_found",
      });
    }
    const {
      id: _id,
      order: _order,
      ...copy
    } = withoutPendingCellEdit(parsed.data);
    let draft: typeof copy = copy;
    if (draft.kind === "sql") {
      // A copied source is kept only while this account may use it. A denied or
      // unreadable source fails the paste; it is never swapped for the default.
      if (draft.dataConnectionId !== null)
        await assertGrantedDataConnection(draft.dataConnectionId);
      const existing = resultVariables(cells);
      draft = {
        ...draft,
        resultVariable:
          draft.resultVariable !== null &&
          existing.includes(draft.resultVariable)
            ? uniqueResultVariable(draft.resultVariable, existing)
            : draft.resultVariable,
      };
    }
    await assertGrantedMetricConnection(draft);
    if (draft.kind === "metric" && draft.metricConfig?.source) {
      const { metricConfig } = draft;
      const sourceId = draft.metricConfig.source.cellId;
      const end = afterCellId
        ? cells.findIndex(({ id }) => id === afterCellId) + 1
        : cells.length;
      if (!cells.slice(0, end).some(({ id }) => id === sourceId))
        draft = {
          ...draft,
          metricConfig: {
            ...metricConfig,
            source: null,
            fieldId: null,
            aggregation: null,
          },
        };
    }
    const created = await addCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      contents: draft,
      ...(afterCellId === undefined ? {} : { afterCellId }),
    });
    return {
      project: await refreshedProjectDocument(scope, project.id),
      createdCellId: created.id,
    };
  },
});
