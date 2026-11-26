import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { mutateExternalCalendars } from "../server/lib/external-calendars.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  description: "Remove a subscribed external calendar feed by ID",
  schema: z.object({
    id: z.string().describe("The ID of the external calendar to remove"),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    await mutateExternalCalendars(email, (current) =>
      current.filter((c) => c.id !== args.id),
    );
    return { success: true };
  },
});
