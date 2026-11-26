import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { analyticsPanelStatusRequestSchema } from "@agent-native/core/shared";
import { z } from "zod";

import { requestContentCitations } from "../server/lib/content-peer.js";
import { openDashboard } from "../server/lib/open-dashboard.js";

const citingPageSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  updatedAt: z.string(),
});

export default defineAction({
  description:
    "Read-only. The Content pages you can open that hold charts from a dashboard you can open, most recently edited first, for the dashboard's Cited in list. Asks Content as you; when Content can't answer, the result says unavailable rather than failing.",
  schema: z.object({
    dashboardId: analyticsPanelStatusRequestSchema.shape.dashboardId,
  }),
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      pages: z.array(citingPageSchema),
      more: z.boolean(),
    }),
    z.object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "content_signed_out",
        "content_unreachable",
        "content_refused",
        "content_invalid_response",
      ]),
    }),
  ]),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  run: async ({ dashboardId }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to see the pages that cite this dashboard.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const opened = await openDashboard(dashboardId, {
      email,
      orgId: getRequestOrgId() || null,
    });
    if (!opened) {
      fail(
        `Dashboard "${dashboardId}" was not found, or you don't have access to it.`,
        { errorCode: "dashboard_not_found", statusCode: 404 },
      );
    }
    const result = await requestContentCitations(
      opened.saved ? opened.saved.id : opened.builtin.id,
    );
    return result.ok
      ? { status: "ok" as const, pages: result.pages, more: result.more }
      : { status: "unavailable" as const, reason: result.code };
  },
});
