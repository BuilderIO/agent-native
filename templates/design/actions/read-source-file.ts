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
