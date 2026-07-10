import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getMonitor } from "../server/lib/uptime-monitors";

export default defineAction({
  description:
    "Get one uptime monitor with its recent check results and incident history.",
  schema: z.object({
    id: z.string().describe("Monitor id."),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const detail = await getMonitor(id, { email, orgId });
    if (!detail) {
      throw Object.assign(new Error("Monitor not found"), { statusCode: 404 });
    }
    return detail;
  },
});
