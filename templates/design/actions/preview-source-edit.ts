import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  findSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import {
  applySourceEdit,
  previewSourceDiff,
  sourceContentHash,
} from "../shared/source-workspace.js";

const sourceEditSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("full-replace"),
    content: z.string().describe("Complete replacement file content"),
  }),
  z.object({
    kind: z.literal("exact-replace"),
    search: z.string().min(1).describe("Unique exact text to replace"),
    replace: z.string().describe("Replacement text"),
  }),
]);

export default defineAction({
  description:
    "Preview a source-file edit without saving it. Returns changed byte counts, " +
    "line range, and compact before/after excerpts for Design code workspace diffs.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      path: z
        .string()
        .optional()
        .describe("Source path/filename, such as index.html"),
      fileId: z.string().optional().describe("Design file ID"),
      edit: sourceEditSchema,
      expectedVersionHash: z
        .string()
        .optional()
        .describe("Optional hash from read-source-file to detect stale edits"),
    })
    .refine((args) => args.path || args.fileId, {
      message: "Provide either path or fileId.",
      path: ["path"],
    }),
  readOnly: true,
  run: async ({ designId, path, fileId, edit, expectedVersionHash }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
    });
    const file = findSourceWorkspaceFile(workspace.files, { fileId, path });
    const live = await readLiveSourceFile(file);
    const stale =
      expectedVersionHash !== undefined &&
      expectedVersionHash !== live.versionHash;
    if (stale) {
      return {
        designId,
        path: file.filename,
        fileId: file.id,
        okToApply: false,
        conflict: "stale-version",
        currentVersionHash: live.versionHash,
        message:
          "Source file changed since it was read. Re-read before saving.",
      };
    }

    const next = applySourceEdit(live.content, edit);
    return {
      designId,
      path: file.filename,
      fileId: file.id,
      okToApply: workspace.canEdit && workspace.sourceType === "inline",
      conflict:
        workspace.sourceType === "inline" ? null : "unsupported-source-backend",
      currentVersionHash: live.versionHash,
      // The hash the file WOULD have after this edit is applied. Do NOT pass
      // this as apply-source-edit's expectedVersionHash — that CAS compares
      // against the CURRENT pre-edit hash, so the post-edit hash would always
      // fail; pass `currentVersionHash` (above) instead to close the
      // preview→apply race, exactly as the code workbench's inline-provider
      // does. `nextVersionHash` is for detecting that the preview's target
      // content changed (compare a later preview/read against it) and for
      // optimistic client bookkeeping of the expected post-apply hash.
      // When nothing changed, the content is still `live.content`, so there
      // is no new hash to report.
      nextVersionHash: next.changed
        ? sourceContentHash(next.content)
        : undefined,
      editsApplied: next.editsApplied,
      diff: previewSourceDiff(live.content, next.content),
    };
  },
});
