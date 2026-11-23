import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  agentNavigationSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import { isNotebookToolWrite } from "../server/lib/notebook-tool-context.js";
import {
  notebookProposalChatUI,
  notebookToolProposalFields,
  proposeNotebookToolChange,
} from "../server/lib/notebook-tool-proposal.js";
import {
  notebookChangeResource,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import { deleteCell } from "../server/model/cells-store.js";
import { requireLegacyCell } from "../server/model/notebook-operations/legacy.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";
import { notebookOriginIdSchema } from "../shared/notebook-undo.js";

export default defineAction({
  mcpTool: true,
  description:
    "Delete one notebook cell and its output. Agent calls stage the deletion for review in the active thread.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      originId: notebookOriginIdSchema.optional(),
      keepOutputForUndo: z
        .boolean()
        .optional()
        .describe("Keep a valid SQL result for undo."),
    })
    .strict(),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  outputSchema: projectDocumentResultSchema.extend({
    deleteStatus: z
      .enum(["saved", "pending_review"])
      .describe(
        "Whether the deletion is already saved or only staged as an unconfirmed pending proposal.",
      ),
    navigation: agentNavigationSchema.optional(),
    outputUndoToken: z.uuid().optional(),
    ...notebookToolProposalFields,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, context) => {
    const { projectId, cellId, keepOutputForUndo, originId } = args;
    if (isNotebookToolWrite(context)) {
      const { newCellId: _unused, ...proposal } =
        await proposeNotebookToolChange(
          context,
          projectId,
          "delete-project-cell",
          args,
          (notebook) => {
            const cell = requireLegacyCell(notebook, cellId);
            return [
              {
                type: "delete",
                cellId: notebookCellIdSchema.parse(cellId),
                expectedRevision: cell.revision,
                expectedOrderRevision: notebook.resources.orderRevision,
              },
            ];
          },
        );
      return { ...proposal, deleteStatus: "pending_review" as const };
    }
    const { scope, project } = await requireWritableProject(projectId);
    const outputUndoToken = await deleteCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId,
      keepOutputForUndo: keepOutputForUndo === true,
      ...(originId === undefined ? {} : { originId }),
    });
    const document = await refreshedProjectDocument(scope, project.id);
    return {
      project: document,
      deleteStatus: "saved" as const,
      ...(outputUndoToken === undefined ? {} : { outputUndoToken }),
      ...(await showAgentProject(context, project.id)),
    };
  },
});
