import { defineAction } from "@agent-native/core/action";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@agent-native/core/notifications";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";

export default defineAction({
  description: "Mark one or all notifications read for the signed-in user.",
  schema: z
    .object({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Notification id; omit to mark all read."),
    })
    .strict(),
  outputSchema: z.object({ updated: z.number() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const { ownerEmail } = await requireCurrentWorkspace();
    if (id)
      return { updated: Number(await markNotificationRead(id, ownerEmail)) };
    return { updated: await markAllNotificationsRead(ownerEmail) };
  },
});
