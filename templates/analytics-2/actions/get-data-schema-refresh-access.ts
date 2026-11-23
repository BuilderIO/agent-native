import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveSchemaRefreshAccess } from "../server/model/data-schema-refresh-access.js";

/**
 * The one browser/agent-readable answer to "may I refresh this connection's
 * schema?". It reads connection metadata only — no provider call and no
 * credential resolution — so it is safe as a mount-time GET.
 *
 * Failures are typed refusals: an unreadable lookup is never `allowed: false`.
 */
export default defineAction({
  description:
    "Resolve whether the current actor may refresh a data connection's schema catalog. Managers always may; other actors also need the connection's schema-refresh flag not disabled. Every actor needs a readable, active connection.",
  schema: z.object({ connectionId: z.string().min(1).max(200) }).strict(),
  outputSchema: z.object({ allowed: z.boolean() }).strict(),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ connectionId }) => {
    const access = await resolveSchemaRefreshAccess(connectionId);
    return { allowed: access.allowed };
  },
});
