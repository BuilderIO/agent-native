import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionRecordingPerformance } from "../server/lib/session-replay.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { SESSION_PAGE_SIZE } from "../shared/session-page.js";

export default defineAction({
  description:
    "Speed summaries for specific session recordings, such as the rows of one list page: each recording's worst measured page-view vitals (ttfbMs, lcpMs, inpMs, cls), slowRequests (requests of 1 s or more; null when no request was measured), maxRequestMs, atLeast (fields that hit the measurement ceiling, so each is a floor), and incomplete (some measurements failed to save, so it may be slower). A recording that was never measured maps to null; ids you cannot read are absent. Also returns coverageStartedAt. Requires the Sessions triage Lab.",
  schema: z.object({
    recordingIds: z
      .array(z.string().min(1).max(200))
      .max(SESSION_PAGE_SIZE)
      .default([])
      .describe(`Recording ids, at most ${SESSION_PAGE_SIZE}: one list page`),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ recordingIds }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    await assertSessionsTriageLabEnabled(userEmail, orgId, ["speed"]);
    return getSessionRecordingPerformance({ userEmail, orgId }, recordingIds);
  },
});
