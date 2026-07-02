import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  findSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import {
  applySourceEdit,
  previewSourceDiff,
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
    "Apply a source-file edit through the shared Design source surface. In the " +
    "MVP this writes inline design_files only and rejects stale version hashes.",
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
        .describe("Hash returned by read-source-file or preview-source-edit"),
    })
    .refine((args) => args.path || args.fileId, {
      message: "Provide either path or fileId.",
      path: ["path"],
    }),
  run: async ({ designId, path, fileId, edit, expectedVersionHash }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
    });
    if (workspace.sourceType !== "inline") {
      throw new Error("Only inline Design files are editable in this MVP.");
    }
    const file = findSourceWorkspaceFile(workspace.files, { fileId, path });
    const live = await readLiveSourceFile(file);
    if (
      expectedVersionHash !== undefined &&
      expectedVersionHash !== live.versionHash
    ) {
      throw new Error(
        "Source file changed since it was read. Re-read the file and retry.",
      );
    }

    const next = applySourceEdit(live.content, edit);
    const write = await writeInlineSourceFile({
      designId,
      file,
      content: next.content,
      expectedVersionHash: expectedVersionHash ?? live.versionHash,
    });

    return {
      designId,
      path: file.filename,
      fileId: file.id,
      backendKind: "virtual-inline",
      changed: write.changed,
      editsApplied: next.editsApplied,
      versionHash: write.versionHash,
      updatedAt: write.updatedAt,
      diff: previewSourceDiff(live.content, next.content),
    };
  },
});
