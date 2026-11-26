import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listPointers, matchPointer } from "../server/lib/pointers-store.js";

export default defineAction({
  description:
    'Look up whether a text query matches a user-saved pointer alias (for example, "my todo list" mapped to a specific document). Returns the matched alias, app id, and object id or URL when found.',
  schema: z.object({
    text: z.string().trim().min(1).max(4000).describe("The user's request."),
  }),
  outputSchema: z.union([
    z.object({
      match: z.literal(true),
      alias: z.string(),
      appId: z.string(),
      objectId: z.string().optional(),
      url: z.string().optional(),
    }),
    z.object({ match: z.literal(false) }),
  ]),
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  readOnly: true,
  parallelSafe: true,
  mcpTool: true,
  run: async ({ text }) => {
    const owner = getRequestUserEmail();
    if (!owner) return { match: false as const };
    const pointer = matchPointer(
      text,
      await listPointers(owner, getRequestOrgId()),
    );
    if (!pointer) return { match: false as const };
    return {
      match: true as const,
      alias: pointer.alias,
      appId: pointer.appId,
      ...(pointer.objectId ? { objectId: pointer.objectId } : {}),
      ...(pointer.url ? { url: pointer.url } : {}),
    };
  },
});
