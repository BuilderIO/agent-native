import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_WIDGET_RENDERER } from "@agent-native/core/action-ui";
import { createDataInsightsWidgetResult } from "@agent-native/core/data-widgets";
import { z } from "zod";

export default defineAction({
  description: "Confirm the deterministic AgentKit browser acceptance step.",
  schema: z.object({
    release: z
      .literal("agentkit-acceptance")
      .describe("The release contract being accepted"),
  }),
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
    title: "Release acceptance",
  },
  needsApproval: true,
  allowPersistentApproval: false,
  http: false,
  run: async ({ release }) => ({
    accepted: release,
    ...createDataInsightsWidgetResult({
      display: { title: "Release accepted" },
      summary: { status: "Approved" },
      table: {
        title: "Acceptance result",
        columns: [
          { key: "release", label: "Release" },
          { key: "status", label: "Status" },
        ],
        rows: [{ release, status: "Accepted" }],
      },
    }),
  }),
});
