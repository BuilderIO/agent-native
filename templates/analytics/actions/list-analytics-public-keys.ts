import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { listAnalyticsPublicKeys } from "../server/lib/first-party-analytics.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "List first-party analytics public write keys for the current user/org. Returns prefixes and status only, not full key values.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return listAnalyticsPublicKeys(resolveScope());
  },
});
