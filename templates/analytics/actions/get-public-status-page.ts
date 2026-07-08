import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getPublicStatusPage } from "../server/lib/status-pages";

/**
 * UNAUTHENTICATED read of a PUBLISHED status page by slug. Returns only the
 * sanitized public projection (display name/host, current status, uptime %s,
 * timeline buckets, optional response time) — never monitor URLs (unless the
 * owner enabled per-monitor "show URL"), headers, assertions, or alert config.
 *
 * Its HTTP route is whitelisted in server/plugins/auth.ts so link visitors and
 * the public SSR page's light auto-refresh can read it without a session. It is
 * hidden from the agent tool surface (`agentTool: false`) — the agent already
 * has the owner-scoped `list-status-pages` / `get-status-page`.
 */
export default defineAction({
  description:
    "Read a published public status page by slug (unauthenticated, safe fields only).",
  schema: z.object({
    slug: z.string().describe("Public status page slug."),
  }),
  http: { method: "GET" },
  // Public, unauthenticated read: no session is required and no owner context is
  // used (the page owner is resolved from the row itself). The HTTP route is
  // also whitelisted in server/plugins/auth.ts.
  requiresAuth: false,
  readOnly: true,
  // Hidden from the agent tool surface — the agent uses the owner-scoped
  // list-status-pages / get-status-page instead.
  agentTool: false,
  run: async ({ slug }) => {
    const page = await getPublicStatusPage(slug);
    if (!page) {
      throw Object.assign(new Error("Status page not found"), {
        statusCode: 404,
      });
    }
    return page;
  },
});
