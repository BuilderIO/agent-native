import { defineAction } from "@agent-native/core";
import {
  appStateKeyForBrowserTab,
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
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
    browserTabId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,96}$/)
      .optional(),
    dashboardId: z.string().min(1).optional(),
    expectedSelection: z.record(z.string(), z.unknown()).optional(),
    source: z.string().min(1).max(96),
  }),
  run: async ({ browserTabId, dashboardId, expectedSelection, source }) => {
    const effectiveBrowserTabId =
      browserTabId ?? getCurrentRequestBrowserTabId();
    const scopedStateKey = appStateKeyForBrowserTab(
      SELECTED_OBJECT_STATE_KEY,
      effectiveBrowserTabId,
    );
    const tabCurrent =
      scopedStateKey === SELECTED_OBJECT_STATE_KEY
        ? null
        : await readAppState(scopedStateKey);
    const globalCurrent =
      !effectiveBrowserTabId || !tabCurrent
        ? await readAppState(SELECTED_OBJECT_STATE_KEY)
        : null;
    const current = tabCurrent ?? globalCurrent;
    const stateKey = tabCurrent ? scopedStateKey : SELECTED_OBJECT_STATE_KEY;
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
        stateKey,
        expectedSelection ?? current,
        null,
      ),
    };
  },
});
