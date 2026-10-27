import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listRecordingFriction } from "../server/lib/session-friction.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import type { SessionRecordingFriction } from "../shared/session-friction.js";
import { SESSION_PAGE_SIZE } from "../shared/session-page.js";

export default defineAction({
  description:
    "Friction for specific session recordings, such as the rows of one list page: the same `friction` object `list-session-recordings` adds with includeFriction (score, signal counts, top signals, agent failures grouped by cause, and linked Monitoring error issues), keyed by recording id. A null part means it was not measured, not zero, and `errorIssues` null means the links are unknown while [] means no issues. Ids you cannot read are absent. Requires the Sessions triage Lab.",
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
  run: async ({ recordingIds }): Promise<SessionRecordingFriction> => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    await assertSessionsTriageLabEnabled(userEmail, orgId, ["friction"]);
    return {
      friction: await listRecordingFriction({ userEmail, orgId }, recordingIds),
    };
  },
});
