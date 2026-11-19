import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listPointers, matchPointer } from "../server/lib/pointers-store.js";

export default defineAction({
  description:
    'Look up whether the user\'s request names something they saved as a pointer (for example "my todo list" saved as a specific doc). Call it BEFORE opening or choosing an app for any request that refers to something by a personal name. When it returns a match, open that app and object instead of guessing from the request.',
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
  readOnly: true,
  parallelSafe: true,
  mcpTool: true,
  run: async ({ text }) => {
    const owner = getRequestUserEmail();
    if (!owner) return { match: false as const };
    const pointer = matchPointer(
      text,
      await listPointers(owner, getRequestOrgId() ?? null),
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
