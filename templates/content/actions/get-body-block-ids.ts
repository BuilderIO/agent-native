import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  blockContentHashesByPath,
  identityBlockIds,
} from "../shared/block-identity-ids.js";
import { readBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { bodyBlocksPropertyIds } from "./_body-block-fields.js";
import { resolveDocumentAccess } from "./_document-access.js";

const editorBlockIdsSchema = z.object({
  shape: z.string(),
  idsByPath: z.record(z.string(), z.string()),
  contentByPath: z.record(z.string(), z.string()),
});

export default defineAction({
  description:
    "Read the IDs a page body's Blocks field gives its blocks, by path, so the editor can put them on its blocks and copy links to them.",
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  http: { method: "GET" },
  schema: z.object({
    documentId: z.string().min(1),
  }),
  outputSchema: z.object({
    ids: editorBlockIdsSchema.nullable(),
    noBlocksField: z.literal(true).optional(),
  }),
  run: async ({ documentId }) => {
    const access = await resolveDocumentAccess(documentId);
    if (!access) return { ids: null };
    const [propertyId] = await bodyBlocksPropertyIds(documentId);
    if (!propertyId) return { ids: null, noBlocksField: true as const };
    const markdown =
      (access.resource.content as string | null | undefined) ?? "";
    const identity = await readBlocksFieldIdentity({
      documentId,
      propertyId,
      markdown,
    });
    if (identity.identityStatus === "stale") return { ids: null };
    return {
      ids: {
        ...identityBlockIds(identity.blocks),
        contentByPath: blockContentHashesByPath(markdown),
      },
    };
  },
});
