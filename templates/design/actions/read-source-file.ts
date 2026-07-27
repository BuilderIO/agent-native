import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  findSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";

export default defineAction({
  description:
    "Read one Design source file. For inline designs this returns live " +
    "design_files content with a version hash for safe follow-up writes.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      path: z
        .string()
        .optional()
        .describe("Source path/filename, such as index.html"),
      fileId: z.string().optional().describe("Design file ID"),
    })
    .refine((args) => args.path || args.fileId, {
      message: "Provide either path or fileId.",
      path: ["path"],
    }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, path, fileId }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
    });
    // The board overlay file is a reserved canvas-model document, not a
    // source file the code workbench edits — resolveSourceWorkspace already
    // excludes it from `files`. Asking for "the board's source" (e.g. a UI
    // surface that follows setActiveFileId to whatever screen a cross-screen
    // drop just landed on, including the board) is a legitimate no-op query,
    // not an error: return an empty/readonly placeholder instead of letting
    // findSourceWorkspaceFile throw a 404-as-500 for every such request.
    if (fileId && workspace.boardFileId && fileId === workspace.boardFileId) {
      return {
        designId,
        path: "__board__.html",
        displayName: "__board__.html",
        fileId,
        sourceType: workspace.sourceType,
        backendKind: "virtual-inline",
        readonly: true,
        language: "html",
        content: "",
        versionHash: "",
        updatedAt: null,
        provenance: {
          kind: "design-file" as const,
          designId,
          fileId,
          filename: "__board__.html",
        },
      };
    }
    const file = findSourceWorkspaceFile(workspace.files, { fileId, path });
    const live = await readLiveSourceFile(file);
    return {
      designId,
      path: file.filename,
      displayName: file.filename,
      fileId: file.id,
      sourceType: workspace.sourceType,
      backendKind: "virtual-inline",
      readonly: !workspace.canEdit || workspace.sourceType !== "inline",
      language: live.language,
      content: live.content,
      versionHash: live.versionHash,
      updatedAt: file.updatedAt,
      provenance: {
        kind: "design-file",
        designId,
        fileId: file.id,
        filename: file.filename,
      },
    };
  },
});
