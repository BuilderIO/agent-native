import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { duplicateDocumentTree } from "./_duplicate-document.js";

export default defineAction({
  description:
    "Duplicate a native Page and its complete native child Page tree atomically into the same Content space. The copy is private and top-level; references keep their targets, and database memberships and source bindings are not copied. Reuse the same idempotencyKey when retrying the same request.",
  schema: z.object({
    id: z
      .string()
      .min(1)
      .describe("Native Page ID at the root of the tree to duplicate"),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Unique retry key for this duplication; reuse it after an uncertain response, use a new key for another copy",
      ),
  }),
  run: async (args, ctx) => {
    const result = await duplicateDocumentTree({ ...args, ctx });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
  link: ({ result }) => ({
    url: `/page/${(result as { id: string }).id}`,
    label: "Open duplicated page",
  }),
});
