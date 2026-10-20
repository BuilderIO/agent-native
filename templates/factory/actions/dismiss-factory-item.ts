import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { recoverFactoryItem } from "../server/lib/factory-item-recovery.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { itemIdSchema } from "../server/lib/workflow-read-actions.js";

export default defineAction({
  description:
    "Close an item that is waiting on a person so no workflow takes it again: needs_manual or failed becomes dismissed, and a Dismissed event goes on its journey. It sends nothing and needs no approval. A repeat changes nothing (changed: false). requeue-factory-item undoes it. Any other status fails with item_not_dismissable.",
  schema: z.object({
    factoryId: factoryIdSchema,
    itemId: itemIdSchema,
  }),
  http: { method: "POST" },
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  audit: {
    target: (args: { itemId: string }) => ({
      type: "factory-item",
      id: args.itemId,
      visibility: "org",
    }),
    summary: (args: { itemId: string }) =>
      `Dismissed Factory item ${args.itemId}`,
  },
  run: (input, context) => recoverFactoryItem("dismiss", input, context),
});
