import { defineAction, defineActionErrors } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  resolveSourceWorkspace,
  SourceWorkspaceEditConflictError,
  writeInlineSourceFilesBatch,
} from "../server/source-workspace.js";
import { moveNodeBetweenDocuments } from "../shared/code-layer.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

const errors = defineActionErrors(
  "design_not_found",
  "screen_not_found",
  "same_screen",
  "unsupported_source",
  "move_unsupported",
  "design_edit_conflict",
);

export default defineAction({
  description:
    "Move one element from one screen of a design to another in a single " +
    "all-or-nothing write: it is removed from the source screen and inserted " +
    "into the destination screen together, or neither screen changes. Use " +
    "this instead of two edit-design calls whenever an element changes " +
    "screens. Pass the element's data-agent-native-node-id as `nodeId` " +
    "(from get-design-snapshot or the current selection), or a unique CSS " +
    "`selector`. Without an anchor the element is appended to the end of the " +
    "destination screen; pass `anchorNodeId` (or `anchorSelector`) with " +
    "`placement` to put it before, after, or inside a specific destination " +
    "element. To move within one screen use apply-visual-edit instead.",
  errors,
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID"),
      sourceFileId: z
        .string()
        .min(1)
        .describe("design_files.id of the screen the element is on now"),
      destFileId: z
        .string()
        .min(1)
        .describe("design_files.id of the screen to move it to"),
      nodeId: z
        .string()
        .min(1)
        .optional()
        .describe("data-agent-native-node-id of the element to move"),
      selector: z
        .string()
        .min(1)
        .optional()
        .describe("Unique CSS selector for the element, when it has no nodeId"),
      anchorNodeId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "data-agent-native-node-id of the destination element to place it next to or inside",
        ),
      anchorSelector: z
        .string()
        .min(1)
        .optional()
        .describe("Unique CSS selector for the destination anchor element"),
      placement: z
        .enum(["before", "after", "inside"])
        .optional()
        .describe(
          'Where the element goes relative to the anchor. Defaults to "inside". Ignored without an anchor.',
        ),
    })
    .superRefine((value, ctx) => {
      if (!value.nodeId && !value.selector) {
        ctx.addIssue({
          code: "custom",
          message: "Pass nodeId or selector to say which element to move.",
          path: ["nodeId"],
        });
      }
    }),
  outputSchema: z.object({
    designId: z.string(),
    sourceFileId: z.string(),
    destFileId: z.string(),
    movedNodeId: z.string(),
    anchorRedirected: z.boolean(),
    moved: z.literal(true),
    _receipt: z.object({
      changed: z.boolean(),
      verified: z.union([z.boolean(), z.literal("unverified")]),
      summary: z.string(),
      subject: z.string().optional(),
    }),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args, context) => {
    const { designId, sourceFileId, destFileId } = args;
    const access = await resolveAccess("design", designId);
    if (!access) {
      return errors.noWrite("Design not found", "design_not_found", {
        statusCode: 404,
      });
    }
    await assertAccess("design", designId, "editor");
    if (
      designSourceTypeFromData((access.resource as { data?: unknown }).data) !==
      "inline"
    ) {
      return errors.noWrite(
        "Moving an element between screens is supported only for inline designs.",
        "unsupported_source",
      );
    }
    if (sourceFileId === destFileId) {
      return errors.noWrite(
        "The element is already on that screen. Use apply-visual-edit to move it within one screen.",
        "same_screen",
      );
    }

    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
    });
    const htmlFiles = workspace.files.filter(
      (file) => file.fileType === "html",
    );
    const source = htmlFiles.find((file) => file.id === sourceFileId);
    const dest = htmlFiles.find((file) => file.id === destFileId);
    if (!source || !dest) {
      return errors.noWrite(
        `Screen not found or not an HTML screen in this design: ${[
          source ? null : sourceFileId,
          dest ? null : destFileId,
        ]
          .filter((id): id is string => id !== null)
          .join(", ")}.`,
        "screen_not_found",
        { statusCode: 404 },
      );
    }

    const [sourceLive, destLive] = await Promise.all([
      readLiveSourceFile(source),
      readLiveSourceFile(dest),
    ]);
    const moved = moveNodeBetweenDocuments(
      sourceLive.content,
      destLive.content,
      {
        ...(args.nodeId ? { nodeId: args.nodeId } : {}),
        ...(args.selector ? { sourceSelector: args.selector } : {}),
        ...(args.anchorNodeId ? { anchorNodeId: args.anchorNodeId } : {}),
        ...(args.anchorSelector ? { anchorSelector: args.anchorSelector } : {}),
        ...(args.placement ? { placement: args.placement } : {}),
      },
    );
    if (moved.status !== "applied" || !moved.movedNodeId) {
      return errors.noWrite(
        moved.message ?? "The element could not be moved to that screen.",
        "move_unsupported",
        { statusCode: 409 },
      );
    }

    await snapshotDesignBeforeAgentEdit(designId, context);
    agentEnterDocument(source.id);
    agentEnterDocument(dest.id);
    try {
      await writeInlineSourceFilesBatch({
        designId,
        files: [
          {
            file: { ...source, content: sourceLive.content },
            content: moved.sourceHtml,
            expectedVersionHash: sourceLive.versionHash,
          },
          {
            file: { ...dest, content: destLive.content },
            content: moved.destHtml,
            expectedVersionHash: destLive.versionHash,
          },
        ],
        expectedHtmlFileIds: htmlFiles.map((file) => file.id),
      });
    } catch (error) {
      if (error instanceof SourceWorkspaceEditConflictError) {
        // The batch is all-or-nothing; the only write before it is the version
        // snapshot, which a retry repeats harmlessly.
        return errors.noWrite(
          `${error.message} Re-read both screens and retry the move.`,
          "design_edit_conflict",
          { statusCode: 409 },
        );
      }
      throw error;
    } finally {
      agentLeaveDocument(source.id);
      agentLeaveDocument(dest.id);
    }

    return {
      designId,
      sourceFileId,
      destFileId,
      movedNodeId: moved.movedNodeId,
      anchorRedirected: moved.anchorRedirected ?? false,
      moved: true as const,
      _receipt: designOutputWriteReceipt(designId, 2),
    };
  },
});
