import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { blockContentHashesByPath } from "../shared/block-identity-ids.js";
import { blocksFieldPathsById } from "../shared/blocks-field-identity.js";
import { readBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { bodyBlocksPropertyIds } from "./_body-block-fields.js";
import { resolveDocumentAccess } from "./_document-access.js";

export default defineAction({
  description:
    "Find the block a link to a page names: where it sits in the page body now, or whether it was deleted.",
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  http: { method: "GET" },
  schema: z.object({
    documentId: z.string().min(1),
    blockId: z.string().min(1).max(200),
  }),
  outputSchema: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("live"),
      path: z.string(),
      content: z.string(),
    }),
    z.object({ state: z.literal("deleted") }),
    z.object({ state: z.literal("missing") }),
  ]),
  run: async ({ documentId, blockId }) => {
    const access = await resolveDocumentAccess(documentId);
    if (!access) return { state: "missing" as const };
    const markdown =
      (access.resource.content as string | null | undefined) ?? "";
    let deleted = false;
    for (const propertyId of await bodyBlocksPropertyIds(documentId)) {
      const identity = await readBlocksFieldIdentity({
        documentId,
        propertyId,
        markdown,
      });
      const path = blocksFieldPathsById(identity.blocks).get(blockId);
      if (path !== undefined) {
        const content = blockContentHashesByPath(markdown)[path] ?? "";
        return { state: "live" as const, path, content };
      }
      deleted ||= identity.tombstones.some((block) => block.id === blockId);
    }
    return deleted
      ? { state: "deleted" as const }
      : { state: "missing" as const };
  },
});
