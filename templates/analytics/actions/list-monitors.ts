import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listMonitors } from "../server/lib/uptime-monitors";

export default defineAction({
  description:
    "List the current user's uptime monitors with their latest status, latency, and 24h/7d uptime percentage.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return listMonitors({ email, orgId });
  },
});
