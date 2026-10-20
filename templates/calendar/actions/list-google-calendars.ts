import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { listGoogleCalendars } from "../server/lib/google-calendar.js";

export default defineAction({
  description:
    "Discover Google Calendar sources available through every connected account. Source keys are opaque and must be passed back to list-events; names and roles in client requests are never trusted.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    return listGoogleCalendars(ownerEmail);
  },
});
