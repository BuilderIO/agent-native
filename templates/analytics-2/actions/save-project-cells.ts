import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  cellContentsSchema,
  type CellContents,
} from "../app/lib/model/contracts.js";
import {
  agentNavigationSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import { isCellRevisionCurrent } from "../server/lib/cell-revision.js";
import { notebookToolCellEdits } from "../server/lib/notebook-tool-cell-edits.js";
import {
  isNotebookToolWrite,
  privateAskNotebookWrite,
} from "../server/lib/notebook-tool-context.js";
import {
  notebookProposalChatUI,
  notebookToolProposalFields,
  proposeNotebookToolChange,
} from "../server/lib/notebook-tool-proposal.js";
import {
  assertGrantedDataConnection,
  assertGrantedMetricConnection,
  assertValidCellConnection,
  notebookChangeResource,
  readWorkingCell,
  requireReadableProject,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import { workspaceAccess } from "../server/lib/workspace-access.js";
import { updateCellsAtomic } from "../server/model/cells-store.js";
import { decodeJsonColumn } from "../server/model/json-column.js";
import { requireLegacyCell } from "../server/model/notebook-operations/legacy.js";

function changedElsewhere(): never {
  return fail("Changed elsewhere", {
    statusCode: 409,
    errorCode: "cell_changed_elsewhere",
  });
}

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  mcpOutputSchema: true,
  description:
    "Save 1 to 200 observed cells atomically. An Ask agent edits its private backing notebook. A notebook review agent stages one pending change for the whole batch.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cells: z
        .array(
          z
            .object({
              cellId: z.string().min(1),
              expectedUpdatedAt: z.string().min(1),
              contents: cellContentsSchema,
            })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict(),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  outputSchema: z.object({
    projectId: z.string(),
    updatedCount: z.number().int(),
    cells: z.array(
      z.object({
        cellId: z.string(),
        updatedAt: z.string(),
        editStatus: z.enum(["saved", "pending_review"]),
      }),
    ),
    navigation: agentNavigationSchema.optional(),
    ...notebookToolProposalFields,
  }),
  run: async (args, context) => {
    const { projectId, cells } = args;
    if (new Set(cells.map((c) => c.cellId)).size !== cells.length)
      fail("Cell ids must be unique.", {
        statusCode: 400,
        errorCode: "duplicate_cell_id",
      });
    for (const item of cells) {
      if (item.contents.id !== item.cellId)
        fail("The saved cell contents belong to a different cell.", {
          statusCode: 400,
          errorCode: "cell_id_mismatch",
        });
    }
    const askWrite = isNotebookToolWrite(context)
      ? await privateAskNotebookWrite(projectId, context)
      : null;
    if (isNotebookToolWrite(context) && !askWrite) {
      const { threadId, proposalIds } = await proposeNotebookToolChange(
        context,
        projectId,
        "save-project-cells",
        args,
        (notebook) =>
          cells.flatMap((item) => {
            const cell = requireLegacyCell(notebook, item.cellId);
            if (!isCellRevisionCurrent(cell, item.expectedUpdatedAt))
              changedElsewhere();
            return notebookToolCellEdits(cell, item.contents);
          }),
      );
      return {
        projectId,
        updatedCount: 0,
        cells: cells.map(({ cellId, expectedUpdatedAt }) => ({
          cellId,
          updatedAt: expectedUpdatedAt,
          editStatus: "pending_review" as const,
        })),
        threadId,
        proposalIds,
      };
    }
    const { scope, project } = await requireReadableProject(projectId);
    await workspaceAccess.assertPermission(["create-project"], scope);
    if (
      project.ownerEmail !== scope.ownerEmail ||
      project.orgId !== scope.orgId
    )
      fail("That project is not in this workspace.", {
        statusCode: 404,
        errorCode: "project_not_found",
      });
    const planned: {
      cellId: string;
      expectedUpdatedAt: string;
      contents: CellContents;
    }[] = [];
    for (const item of cells) {
      const stored = await readWorkingCell(project, item.cellId);
      const storedContents = decodeJsonColumn(
        stored.contents,
        cellContentsSchema,
      );
      if (!storedContents)
        fail("A stored cell is missing its contents.", {
          statusCode: 500,
          errorCode: "cell_contents_missing",
        });
      if (!isCellRevisionCurrent(stored, item.expectedUpdatedAt))
        changedElsewhere();
      if (item.contents.kind !== stored.kind)
        fail("A saved cell cannot change its kind.", {
          statusCode: 400,
          errorCode: "cell_kind_change",
        });
      let nextContents = item.contents;
      if (storedContents.kind === "sql" && nextContents.kind === "sql") {
        const { pendingEdit: _ignored, ...rest } = nextContents;
        nextContents = storedContents.pendingEdit
          ? { ...rest, pendingEdit: storedContents.pendingEdit }
          : rest;
      }
      assertValidCellConnection(nextContents);
      if (nextContents.kind === "sql" && nextContents.dataConnectionId !== null)
        await assertGrantedDataConnection(nextContents.dataConnectionId);
      await assertGrantedMetricConnection(nextContents, storedContents);
      planned.push({ ...item, contents: nextContents });
    }
    const draft = await requireWritableProject(project.id);
    const revisions = await updateCellsAtomic({
      ...scope,
      projectId: project.id,
      versionId: draft.project.workingVersionId,
      cells: planned,
    });
    return {
      projectId: project.id,
      updatedCount: revisions.length,
      cells: revisions.map((revision) => ({
        ...revision,
        editStatus: "saved" as const,
      })),
      ...(askWrite ? {} : await showAgentProject(context, project.id)),
    };
  },
});
