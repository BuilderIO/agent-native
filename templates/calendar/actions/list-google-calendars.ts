import { defineAction } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { listGoogleCalendars } from "../server/lib/google-calendar.js";
import { SHARED_GOOGLE_CALENDARS } from "../shared/feature-flags.js";

export default defineAction({
  description:
    "Discover Google Calendar sources available through every connected account. Source keys are opaque and must be passed back to list-events; names and roles in client requests are never trusted.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (_args, ctx) => {
    if (!(await isFeatureFlagEnabled(SHARED_GOOGLE_CALENDARS, ctx))) {
      throw new Error("Shared Google calendars is not enabled");
    }
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    return listGoogleCalendars(ownerEmail);
  },
});
