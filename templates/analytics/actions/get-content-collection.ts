import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { readContentCollectionStatus } from "../server/lib/content-metrics/status.js";

export default defineAction({
  description:
    "Read the organization's Content view collection: whether the daily job is on, which steps it runs, the stored owner whose connections it uses, and each step's last run (status succeeded, failed, cost_limited, not_configured or running, with its error and window). Reads Postgres only; it never calls a provider or BigQuery.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = getRequestUserEmail() || ctx?.userEmail;
    if (!email) {
      fail("Sign in to read content collection.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || ctx?.orgId;
    if (!orgId) {
      fail("An active organization is required to read content collection.", {
        errorCode: "organization_required",
        statusCode: 403,
      });
    }
    return readContentCollectionStatus(orgId, email);
  },
});
