import {
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  defineAction,
} from "@agent-native/core";
import { createDataInsightsWidgetResult } from "@agent-native/core/data-widgets";
import { z } from "zod";

export default defineAction({
  description: "Return deterministic sample Forms insights for acceptance.",
  schema: z.object({ formId: z.string() }),
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
    title: "Response insights",
  },
  http: false,
  readOnly: true,
  run: async () =>
    createDataInsightsWidgetResult({
      widgetId: "forms.responseInsights.v1",
      display: { title: "AgentKit sample form insights" },
      summary: { responses: 1, status: "Published" },
      table: {
        title: "Sample form responses",
        columns: [
          { key: "field", label: "Field" },
          { key: "value", label: "Value" },
        ],
        rows: [{ field: "Favorite template", value: "AgentKit acceptance" }],
      },
    }),
});
