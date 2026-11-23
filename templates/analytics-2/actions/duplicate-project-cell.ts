import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

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
import { newId } from "../server/model/ids.js";
import {
  applyLegacyNotebookOperation,
  legacyGap,
  readLegacyNotebook,
  requireAppliedNotebookOperation,
  requireLegacyCell,
} from "../server/model/notebook-operations/legacy.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";
import { notebookOriginIdSchema } from "../shared/notebook-undo.js";

/**
 * Copies one cell and places the copy directly after it, the way the source's
 * cell menu "Duplicate" does. The copy gets its own id and order; the source's
 * saved output is not copied.
 */
export default defineAction({
  description:
    "Duplicate a notebook cell directly after itself. Agent calls stage the duplicate for review in the active thread.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      originId: notebookOriginIdSchema.optional(),
    })
    .strict(),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  outputSchema: projectDocumentResultSchema.extend({
    cellStatus: z
      .enum(["saved", "pending_review"])
      .describe(
        "Whether the duplicate cell is already saved or only staged as an unconfirmed pending proposal.",
      ),
    createdCellId: z.string(),
    ...notebookToolProposalFields,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args, context) => {
    const { projectId, cellId, originId } = args;
    if (isNotebookToolWrite(context)) {
      const { newCellId, ...proposal } = await proposeNotebookToolChange(
        context,
        projectId,
        "duplicate-project-cell",
        args,
        (notebook, createdCellId) => {
          const source = requireLegacyCell(notebook, cellId);
          return [
            {
              type: "duplicate",
              cellId: createdCellId,
              fromCellId: notebookCellIdSchema.parse(source.id),
              expectedRevision: source.revision,
              expectedOrderRevision: notebook.resources.orderRevision,
              gap: legacyGap(
                notebook.cells,
                notebook.cells.indexOf(source) + 1,
              ),
            },
          ];
        },
      );
      return {
        ...proposal,
        cellStatus: "pending_review" as const,
        createdCellId: newCellId,
      };
    }
    const { scope, project } = await requireWritableProject(projectId);
    const draft = await readLegacyNotebook(scope, project.id);
    const source = requireLegacyCell(draft, cellId);
    const createdCellId = notebookCellIdSchema.parse(newId("cel"));
    requireAppliedNotebookOperation(
      await applyLegacyNotebookOperation(
        scope,
        draft.notebook,
        [
          {
            type: "duplicate",
            cellId: createdCellId,
            fromCellId: notebookCellIdSchema.parse(source.id),
            expectedRevision: source.revision,
            expectedOrderRevision: draft.notebook.resources.orderRevision,
            gap: legacyGap(draft.cells, draft.cells.indexOf(source) + 1),
          },
        ],
        undefined,
        originId,
      ),
    );
    return {
      project: await refreshedProjectDocument(scope, project.id),
      cellStatus: "saved" as const,
      createdCellId,
    };
  },
});
