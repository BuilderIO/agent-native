import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  documentHistoryCheckpointDetail,
  findDocumentCheckpoint,
} from "../server/lib/document-version-names.js";
import type { DocumentHistoryCheckpointDetail } from "../shared/document-history.js";

export default defineAction({
  description:
    "Read a page as it was at one saved version: its title and full body. Pass versionId (from list-document-versions) or the version's exact versionName, ignoring case.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    versionId: z.string().min(1).optional().describe("Checkpoint version ID"),
    versionName: z
      .string()
      .min(1)
      .optional()
      .describe("Name given to the version, such as Week of Nov 17"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  searchHints: ["page as it was", "read old version", "named version"],
  run: async (
    args,
  ): Promise<{ checkpoint: DocumentHistoryCheckpointDetail }> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const row = await findDocumentCheckpoint({
      ownerEmail: access.resource.ownerEmail as string,
      documentId: args.documentId,
      versionId: args.versionId,
      versionName: args.versionName,
    });
    return { checkpoint: documentHistoryCheckpointDetail(row) };
  },
});
