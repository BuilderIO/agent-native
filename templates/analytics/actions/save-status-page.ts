import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { saveStatusPage } from "../server/lib/status-pages";

export default defineAction({
  description:
    "Create or update a public status page. Pass id to update, omit to create. Include monitors to set the full included set (each with an optional display-name override and per-monitor showUrl opt-in).",
  schema: z.object({
    id: z.string().optional().describe("Status page id (omit to create)."),
    slug: z
      .string()
      .optional()
      .describe("Public URL slug; auto-derived from the title when omitted."),
    title: z.string().optional().describe("Status page title."),
    description: z.string().nullable().optional(),
    published: z
      .boolean()
      .optional()
      .describe("Whether the page is publicly readable."),
    showUptimeBars: z.boolean().optional(),
    showOverallUptime: z.boolean().optional(),
    showResponseTime: z.boolean().optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    alignment: z.enum(["left", "center"]).optional(),
    monitors: z
      .array(
        z.object({
          monitorId: z.string(),
          displayName: z.string().nullable().optional(),
          showUrl: z.boolean().optional(),
        }),
      )
      .optional()
      .describe("Full set of included monitors, in display order."),
  }),
  run: async (input) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return saveStatusPage(input, { email, orgId });
  },
});
