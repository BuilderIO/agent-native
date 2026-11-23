import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import type { Cell } from "../app/lib/model/contracts.js";
import { isNotebookToolWrite } from "../server/lib/notebook-tool-context.js";
import {
  invalidNotebookProposal,
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
import {
  applyLegacyNotebookOperation,
  readLegacyNotebook,
  requireAppliedNotebookOperation,
  requireLegacyCell,
} from "../server/model/notebook-operations/legacy.js";
import type { NotebookSectionChange } from "../shared/notebook-operations.js";
import { sectionParent } from "../shared/notebook-sections.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";
import type { Revision } from "../shared/notebook-snapshot-contract.js";
import { notebookOriginIdSchema } from "../shared/notebook-undo.js";

type MoveInput = {
  cellId: string;
  direction?: "up" | "down" | undefined;
  target?: { cellId: string; placement: "before" | "after" } | undefined;
};

function destination(
  cells: readonly { id: string }[],
  { cellId, direction, target }: MoveInput,
): number | null {
  if (target !== undefined) {
    if (target.cellId === cellId)
      fail("A cell cannot be moved relative to itself.", {
        statusCode: 400,
        errorCode: "invalid_move",
      });
    const others = cells.filter((cell) => cell.id !== cellId);
    const at = others.findIndex((cell) => cell.id === target.cellId);
    if (at < 0)
      fail("The target cell is not in this project.", {
        statusCode: 404,
        errorCode: "cell_not_found",
      });
    return target.placement === "before" ? at : at + 1;
  }
  const index = cells.findIndex((cell) => cell.id === cellId);
  const next = direction === "up" ? index - 1 : index + 1;
  return next >= 0 && next < cells.length ? next : null;
}

function positionChange(
  cells: readonly Cell[],
  current: Cell,
  input: MoveInput,
  expectedOrderRevision: Revision,
): Extract<NotebookSectionChange, { type: "move-to-section" }> | null {
  const anchor = input.target
    ? requireLegacyCell({ cells }, input.target.cellId)
    : current;
  const parent = sectionParent(anchor);
  const siblings = cells.filter((cell) => sectionParent(cell) === parent);
  const position = destination(siblings, input);
  if (position === null || position === siblings.indexOf(current)) return null;
  const before = siblings.filter(({ id }) => id !== current.id).at(position);
  const cellId = notebookCellIdSchema.parse(current.id);
  return {
    type: "move-to-section",
    cellId,
    cellIds: [cellId],
    parentSectionId:
      parent === null ? null : notebookCellIdSchema.parse(parent),
    ...(before === undefined
      ? {}
      : { beforeCellId: notebookCellIdSchema.parse(before.id) }),
    expectedOrderRevision,
  };
}

export default defineAction({
  description:
    "Move a notebook cell up or down among its siblings or before or after another cell in that cell's Section. Agent calls stage the move for review in the active thread.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      direction: z.enum(["up", "down"]).optional(),
      target: z
        .object({
          cellId: z.string().min(1),
          placement: z.enum(["before", "after"]),
        })
        .strict()
        .optional(),
      originId: notebookOriginIdSchema.optional(),
    })
    .strict()
    .refine(
      (input) =>
        (input.direction === undefined) !== (input.target === undefined),
      { message: "Give either a direction or a target cell to move to." },
    ),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  outputSchema: projectDocumentResultSchema.extend({
    moveStatus: z
      .enum(["saved", "pending_review"])
      .describe(
        "Whether the move is already saved or only staged as an unconfirmed pending proposal.",
      ),
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
      const { newCellId: _unused, ...proposal } =
        await proposeNotebookToolChange(
          context,
          projectId,
          "move-project-cell",
          args,
          (notebook) => {
            const current = requireLegacyCell(notebook, cellId);
            const change = positionChange(
              notebook.cells,
              current,
              args,
              notebook.resources.orderRevision,
            );
            if (!change) invalidNotebookProposal();
            return [change];
          },
        );
      return { ...proposal, moveStatus: "pending_review" as const };
    }
    const { scope, project } = await requireWritableProject(projectId);
    const draft = await readLegacyNotebook(scope, project.id);
    const current = requireLegacyCell(draft, cellId);
    const change = positionChange(
      draft.cells,
      current,
      args,
      draft.notebook.resources.orderRevision,
    );
    if (change)
      requireAppliedNotebookOperation(
        await applyLegacyNotebookOperation(
          scope,
          draft.notebook,
          [change],
          undefined,
          originId,
        ),
      );
    return {
      project: await refreshedProjectDocument(scope, project.id),
      moveStatus: "saved" as const,
    };
  },
});
