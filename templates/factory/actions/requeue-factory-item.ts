import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { recoverFactoryItem } from "../server/lib/factory-item-recovery.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { itemIdSchema } from "../server/lib/workflow-read-actions.js";

export default defineAction({
  description:
    "Send an item that needs a person back to its workflow: its status returns to the queue the workflow's source reads, the attempts it spent clear, and a Requeued event goes on its journey. For an item in needs_manual or failed, or one dismissed by mistake, once what stopped it is fixed (list-workflow-items needsYou finds them). An inbox poll or status source takes it on its next run; a source that only reads a provider's new records may not offer it again. A write that already went out is not repeated, and one that may have gone out stops for a person again, so check the provider first. It stops for the user's approval in chat because the workflow may then send messages or update records: say which item and what it may trigger before calling, and do not report it as retried until the call returns. A repeat on an item already queued changes nothing (changed: false). Any other status fails with item_not_requeueable.",
  schema: z.object({
    factoryId: factoryIdSchema,
    itemId: itemIdSchema,
  }),
  http: { method: "POST" },
  // A repeat finds the item queued and changes nothing, so the model may call again.
  retrySafe: true,
  // The agent's, MCP and WebMCP calls ask a person; the Items drawer button is
  // the person. Always-allow would turn the gate off for every later requeue,
  // and the gate exists for the call a message the agent read talked it into.
  needsApproval: true,
  allowPersistentApproval: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  audit: {
    target: (args: { itemId: string }) => ({
      type: "factory-item",
      id: args.itemId,
      visibility: "org",
    }),
    summary: (args: { itemId: string }) =>
      `Requeued Factory item ${args.itemId}`,
  },
  run: (input, context) => recoverFactoryItem("requeue", input, context),
});
