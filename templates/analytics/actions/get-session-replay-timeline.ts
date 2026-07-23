import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionReplayTimeline } from "../server/lib/session-replay-agent-context.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Get a bounded, sanitized timeline for one first-party Analytics session recording: page navigation, clicks, inputs, scrolls, custom events, console errors, and failed network requests. Returns marker metadata only; never returns raw rrweb/DOM/input values, replay chunks, or storage references. Use this after get-session-replay-summary when direct incident triage needs the user's click/page sequence.",
  schema: z.object({
    recordingId: z.string().describe("The session_recordings id"),
    eventLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .default(10000)
      .describe(
        "Maximum replay events to inspect before building the capped timeline",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    return getSessionReplayTimeline(args.recordingId, resolveScope(), {
      eventLimit: args.eventLimit,
    });
  },
});
