import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  defineAction,
} from "@agent-native/core";
import { createDataTableWidgetResult } from "@agent-native/core/data-widgets";
import { z } from "zod";

export default defineAction({
  description: "Return deterministic sample Analytics rows for acceptance.",
  schema: z.object({ sql: z.string() }),
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_TABLE_RENDERER,
    title: "Analytics query result",
  },
  http: false,
  readOnly: true,
  run: async () =>
    createDataTableWidgetResult({
      widgetId: "analytics.query.v1",
      title: "Sample analytics result",
      table: {
        title: "Sample analytics table",
        columns: [
          { key: "page", label: "Page" },
          { key: "views", label: "Views", align: "right" },
        ],
        rows: [{ page: "/agentkit-acceptance", views: 12 }],
      },
    }),
});
