import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionRecordingOutputs } from "../server/lib/output-outcomes.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { OUTPUT_USE_WINDOW_DAYS } from "../shared/output-use.js";
import { SESSION_PAGE_SIZE } from "../shared/session-page.js";

export default defineAction({
  description: `The outputs each session recording's session made, such as Slides decks, for the rows of one list page or one replay: outputId, outputType, madeAt, useBy (madeAt plus ${OUTPUT_USE_WINDOW_DAYS} days), status, usedEvent and usedAt when used in time, and url (the app page that opens it; the app checks access). Status is used (presented or exported within the window), unused (window closed with no use), open (window still open), or unmeasured (a failed write may have dropped a use). A recording with no tracked outputs is absent, as are ids you cannot read. Also returns coverageStartedAt: null means output tracking has not started for the viewer. Requires the Sessions triage Lab.`,
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
    await assertSessionsTriageLabEnabled(userEmail, orgId, ["outputs"]);
    return getSessionRecordingOutputs({ userEmail, orgId }, recordingIds);
  },
});
