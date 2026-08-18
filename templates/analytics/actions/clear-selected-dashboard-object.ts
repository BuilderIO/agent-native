import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";

function selectedDashboardId(value: Record<string, unknown>): string | null {
  const id =
    value.type === "dashboard"
      ? value.id
      : value.type === "dashboard-panel"
        ? value.dashboardId
        : null;
  return typeof id === "string" ? id : null;
}

export default defineAction({
  agentTool: false,
  description:
    "Clear the current browser tab's Analytics dashboard selection when it still belongs to that tab.",
  schema: z.object({
    dashboardId: z.string().min(1).optional(),
    source: z.string().min(1).max(96),
  }),
  run: async ({ dashboardId, source }) => {
    const current = await readAppState(SELECTED_OBJECT_STATE_KEY);
    if (!current || current[SELECTED_OBJECT_SOURCE_FIELD] !== source) {
      return { cleared: false };
    }

    const currentDashboardId = selectedDashboardId(current);
    if (!currentDashboardId) return { cleared: false };
    if (dashboardId && currentDashboardId !== dashboardId) {
      return { cleared: false };
    }

    return {
      cleared: await compareAndSetAppState(
        SELECTED_OBJECT_STATE_KEY,
        current,
        null,
      ),
    };
  },
});
