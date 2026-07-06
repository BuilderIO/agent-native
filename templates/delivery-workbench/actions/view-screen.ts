import { defineAction } from "@agent-native/core";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

import {
  getWorkItem,
  listRoutingRules,
  listWorkItems,
} from "../server/lib/work-items.js";

export default defineAction({
  description:
    "See the current Delivery Workbench queue/detail context from application state.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation", {
      fallbackToGlobal: true,
    }).catch(() => null);
    const url = (await readAppState("__url__").catch(() => null)) as {
      searchParams?: Record<string, string>;
    } | null;
    const nav = navigation as {
      view?: string;
      workItemId?: string;
      filters?: Record<string, string | undefined>;
    } | null;
    const activeFilters = {
      ...(url?.searchParams ?? {}),
      ...(nav?.filters ?? {}),
    };
    const listFilters = {
      status: activeFilters.status as any,
      priority: activeFilters.priority as any,
      provider: activeFilters.provider,
      assigneeEmail: activeFilters.assigneeEmail ?? activeFilters.assignee,
      tag: activeFilters.tag,
      search: activeFilters.search ?? activeFilters.q,
      limit: 25,
    };
    const screen: Record<string, unknown> = {
      navigation,
      activeFilters,
    };

    if (nav?.workItemId) {
      screen.workItem = await getWorkItem(nav.workItemId);
    }
    if (!nav?.workItemId || nav.view === "queue") {
      screen.queue = await listWorkItems(listFilters);
    }
    if (nav?.view === "routing-rules") {
      screen.routingRules = await listRoutingRules();
    }
    return screen;
  },
});
