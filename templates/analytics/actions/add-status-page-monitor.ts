import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { addStatusPageMonitor } from "../server/lib/status-pages";

export default defineAction({
  description:
    "Add a monitor to a status page (appended to the end, deduplicated). The monitor must be owned by the current user.",
  schema: z.object({
    id: z.string().describe("Status page id."),
    monitorId: z.string().describe("Monitor id to add."),
    displayName: z
      .string()
      .nullable()
      .optional()
      .describe("Optional public display-name override."),
    showUrl: z
      .boolean()
      .optional()
      .describe("Opt in to publicly showing this monitor's URL/host."),
  }),
  run: async ({ id, monitorId, displayName, showUrl }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return addStatusPageMonitor(
      id,
      { monitorId, displayName, showUrl },
      { email, orgId },
    );
  },
});
