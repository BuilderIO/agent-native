import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { readIndexSchedule } from "../server/lib/index-schedule.js";

export default defineAction({
  description:
    "Read the organization's scheduled data index build: whether it is enabled, its cron expression, timezone, and automation name. Returns disabled, daily at 06:00 UTC, when nothing is saved.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = getRequestUserEmail() || ctx?.userEmail;
    if (!email) {
      fail("Sign in to read the index schedule.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || ctx?.orgId;
    if (!orgId) {
      fail("An active organization is required to read the index schedule.", {
        errorCode: "organization_required",
        statusCode: 403,
      });
    }
    return readIndexSchedule(orgId);
  },
});
