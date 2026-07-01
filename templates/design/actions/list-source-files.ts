import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { resolveSourceWorkspace } from "../server/source-workspace.js";

export default defineAction({
  description:
    "List source files for a Design code workspace. In the current MVP this " +
    "returns inline SQL-backed design_files by filename; future localhost and " +
    "container source backends will use the same shape.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const workspace = await resolveSourceWorkspace(designId);
    const readonly = !workspace.canEdit || workspace.sourceType !== "inline";
    return {
      designId,
      backend: {
        kind: "virtual-inline" as const,
        workspaceUri: `designfs://${designId}/`,
        designId,
        capabilities: {
          readFile: true,
          writeFile: workspace.canEdit && workspace.sourceType === "inline",
          diff: true,
        },
      },
      sourceType: workspace.sourceType,
      files: workspace.files.map((file) => ({
        path: file.filename,
        displayName: file.filename,
        kind: "file" as const,
        sourceType: workspace.sourceType,
        fileId: file.id,
        readonly,
        reason: readonly
          ? workspace.canEdit
            ? "Only inline Design files are editable in this MVP."
            : "You need editor access to change this file."
          : undefined,
        language:
          file.fileType === "html" || file.fileType === "css"
            ? file.fileType
            : undefined,
        updatedAt: file.updatedAt,
      })),
    };
  },
});
