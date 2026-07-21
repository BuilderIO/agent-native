import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { createHubSpotCrmAdapter } from "../server/crm/hubspot-adapter.js";
import {
  parseCrmAccessScope,
  scopesAreCompatible,
} from "../server/crm/read-through.js";
import {
  getCrmOverview,
  getCrmRecord,
  getCrmRecordReadContext,
  listCrmProposals,
  listCrmRecords,
  listCrmSavedViews,
  listCrmTasks,
} from "../server/db/crm-store.js";
import { getDb, schema } from "../server/db/index.js";

type VisibleView =
  | "work"
  | "account"
  | "person"
  | "opportunity"
  | "record"
  | "tasks"
  | "proposals"
  | "views"
  | "ask"
  | "setup"
  | "settings";

export default defineAction({
  description:
    "Return an access-scoped snapshot of the visible CRM screen, including relevant records, tasks, proposals, saved views, or setup state.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = (await readAppStateForCurrentTab("navigation")) as {
      view?: VisibleView;
      recordId?: string;
      viewId?: string;
      query?: string;
    } | null;
    const url = await readAppStateForCurrentTab("__url__");
    const screen: Record<string, unknown> = { navigation, url };

    switch (navigation?.view) {
      case "record":
        screen.record = navigation.recordId
          ? await readVisibleRecord(navigation.recordId)
          : null;
        break;
      case "account":
      case "person":
      case "opportunity":
        screen.records = await listCrmRecords({
          kind: navigation.view,
          query: navigation.query,
          viewId: navigation.viewId,
          limit: 50,
        });
        break;
      case "tasks":
        screen.tasks = await listCrmTasks({ limit: 50 });
        break;
      case "proposals":
        screen.proposals = await listCrmProposals({ limit: 50 });
        break;
      case "views":
        screen.savedViews = await listCrmSavedViews({ limit: 50 });
        break;
      case "ask":
        [screen.overview, screen.savedViews] = await Promise.all([
          getCrmOverview(),
          listCrmSavedViews({ limit: 20 }),
        ]);
        break;
      case "setup":
      case "settings":
        screen.connections = await visibleConnections();
        break;
      case "work":
      case undefined:
        screen.overview = await getCrmOverview();
        break;
    }

    return screen;
  },
});

async function readVisibleRecord(recordId: string) {
  const context = await getCrmRecordReadContext(recordId);
  if (
    !context ||
    context.provider !== "hubspot" ||
    !context.workspaceConnectionId
  ) {
    return null;
  }
  const adapter = await createHubSpotCrmAdapter({
    connectionId: context.workspaceConnectionId,
  });
  const currentScope = adapter.getAccessScope(context.objectType);
  if (
    !scopesAreCompatible(
      parseCrmAccessScope(context.accessScopeJson),
      currentScope,
    )
  ) {
    return null;
  }
  return getCrmRecord(recordId, { accessScope: currentScope });
}

async function visibleConnections() {
  return getDb()
    .select({
      id: schema.crmConnections.id,
      provider: schema.crmConnections.provider,
      label: schema.crmConnections.label,
      mode: schema.crmConnections.mode,
      status: schema.crmConnections.status,
      lastSyncedAt: schema.crmConnections.lastSyncedAt,
      updatedAt: schema.crmConnections.updatedAt,
    })
    .from(schema.crmConnections)
    .where(accessFilter(schema.crmConnections, schema.crmConnectionShares))
    .orderBy(desc(schema.crmConnections.updatedAt))
    .limit(20);
}
