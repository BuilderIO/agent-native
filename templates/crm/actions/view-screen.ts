import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { accessFilter } from "@agent-native/core/sharing";
import { asc, desc } from "drizzle-orm";
import { z } from "zod";

import {
  createConnectedCrmAdapter,
  isConnectedCrmProvider,
} from "../server/crm/adapter.js";
import { createNativeCrmAdapter } from "../server/crm/native-adapter.js";
import { loadVerifiedReadThroughRecord } from "../server/crm/read-through.js";
import {
  getCrmOverview,
  getCrmRecord,
  getCrmRecordReadContext,
  getReadThroughRelationshipSummaries,
  listCrmProposals,
  listCrmRecords,
  listCrmSavedViews,
  listCrmSignals,
  listCrmTasks,
} from "../server/db/crm-store.js";
import { crmDashboardStore, getDb, schema } from "../server/db/index.js";

type VisibleView =
  | "work"
  | "account"
  | "person"
  | "opportunity"
  | "record"
  | "tasks"
  | "proposals"
  | "views"
  | "dashboard"
  | "ask"
  | "setup"
  | "settings";

export default defineAction({
  description:
    "Return an access-scoped snapshot of the visible CRM screen, including relevant records, tasks, proposals, saved views, or setup state.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx?: ActionRunContext) => {
    const navigation = (await readAppStateForCurrentTab("navigation")) as {
      view?: VisibleView;
      recordId?: string;
      viewId?: string;
      dashboardId?: string;
      query?: string;
    } | null;
    const url = await readAppStateForCurrentTab("__url__");
    const screen: Record<string, unknown> = { navigation, url };

    switch (navigation?.view) {
      case "record":
        if (navigation.recordId) {
          [screen.record, screen.signals] = await Promise.all([
            readVisibleRecord(navigation.recordId, ctx),
            listCrmSignals({ recordId: navigation.recordId, limit: 50 }),
          ]);
        } else {
          screen.record = null;
          screen.signals = [];
        }
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
      case "dashboard":
        {
          const dashboards = await crmDashboardStore.list({
            userEmail: ctx?.userEmail,
            orgId: ctx?.orgId ?? undefined,
          });
          screen.dashboards = dashboards;
          screen.dashboard = navigation?.dashboardId
            ? (dashboards.find(
                (dashboard: { id: string }) =>
                  dashboard.id === navigation.dashboardId,
              ) ?? null)
            : (dashboards[0] ?? null);
        }
        break;
      case "ask":
        [screen.overview, screen.savedViews] = await Promise.all([
          getCrmOverview(),
          listCrmSavedViews({ limit: 20 }),
        ]);
        break;
      case "setup":
        screen.connections = await visibleConnections();
        break;
      case "settings":
        screen.connections = await visibleConnections();
        screen.signalTrackers = await visibleSignalTrackers();
        break;
      case "work":
      case undefined:
        screen.overview = await getCrmOverview();
        break;
    }

    return screen;
  },
});

async function readVisibleRecord(recordId: string, ctx?: ActionRunContext) {
  const context = await getCrmRecordReadContext(recordId);
  if (!context) return null;
  const adapter =
    context.provider === "native"
      ? await createNativeCrmAdapter({
          connectionId: context.connectionId,
          accessTier: "viewer",
        })
      : isConnectedCrmProvider(context.provider) &&
          context.workspaceConnectionId
        ? await createConnectedCrmAdapter({
            provider: context.provider,
            connectionId: context.workspaceConnectionId,
            ...(ctx?.userEmail ? { userEmail: ctx.userEmail } : {}),
            ...(ctx?.orgId !== undefined ? { orgId: ctx.orgId } : {}),
          })
        : null;
  if (!adapter) return null;
  let readThrough;
  try {
    readThrough = await loadVerifiedReadThroughRecord({ adapter, context });
  } catch {
    return null;
  }
  const relatedRecords = await getReadThroughRelationshipSummaries({
    context,
    relationships: readThrough.relationships,
    currentScopes: readThrough.currentScopes,
  });
  return getCrmRecord(recordId, {
    displayName: readThrough.remote.displayName,
    fields: readThrough.remote.fields,
    remoteRevision: readThrough.remote.remoteRevision,
    remoteUpdatedAt: readThrough.remote.remoteUpdatedAt,
    relatedRecords,
    accessScope: readThrough.currentScope,
  });
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

async function visibleSignalTrackers() {
  const trackers = await getDb()
    .select({
      id: schema.crmSignalTrackers.id,
      name: schema.crmSignalTrackers.name,
      description: schema.crmSignalTrackers.description,
      kind: schema.crmSignalTrackers.kind,
      keywordsJson: schema.crmSignalTrackers.keywordsJson,
      classifierPrompt: schema.crmSignalTrackers.classifierPrompt,
      enabled: schema.crmSignalTrackers.enabled,
      isDefault: schema.crmSignalTrackers.isDefault,
    })
    .from(schema.crmSignalTrackers)
    .where(
      accessFilter(schema.crmSignalTrackers, schema.crmSignalTrackerShares),
    )
    .orderBy(asc(schema.crmSignalTrackers.name));
  return trackers.map((tracker) => ({
    ...tracker,
    keywords: safeKeywords(tracker.keywordsJson),
    keywordsJson: undefined,
  }));
}

function safeKeywords(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (keyword): keyword is string => typeof keyword === "string",
        )
      : [];
  } catch {
    return [];
  }
}
