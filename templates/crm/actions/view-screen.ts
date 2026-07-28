import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, desc, eq } from "drizzle-orm";
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
  listCrmSavedViews,
  listCrmSignals,
  listCrmTasks,
} from "../server/db/crm-store.js";
import { crmDashboardStore, getDb, schema } from "../server/db/index.js";
import { loadCrmSavedView, queryCrmRecords } from "../server/lib/crm-query.js";
import {
  parseCrmNavigationSelection,
  type CrmNavigationSelection,
  type CrmView,
} from "../shared/crm-navigation.js";

export default defineAction({
  description:
    "Return an access-scoped snapshot of the visible CRM screen: the current selection plus the relevant records, lists, saved view and its board grouping, tasks, proposals, or setup state.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx?: ActionRunContext) => {
    const navigation = (await readAppStateForCurrentTab("navigation")) as {
      view?: CrmView;
      path?: string;
      recordId?: string;
      viewId?: string;
      dashboardId?: string;
      query?: string;
      settingsSection?: string;
    } | null;
    const url = await readAppStateForCurrentTab("__url__");
    // The route hook publishes the visited path with its search string, and for
    // the list/board surfaces the search params ARE the selection. Reading them
    // back here beats maintaining a second copy of that state.
    const parsed = parseCrmNavigationSelection(
      navigation?.path ?? (typeof url === "string" ? url : null),
    );
    const selection = resolveSelection(navigation, parsed);
    const actorEmail = ctx?.userEmail ?? getRequestUserEmail() ?? null;
    const screen: Record<string, unknown> = { navigation, url, selection };

    switch (navigation?.view) {
      case "record":
        if (selection.recordId) {
          [screen.record, screen.signals] = await Promise.all([
            readVisibleRecord(selection.recordId, ctx),
            listCrmSignals({ recordId: selection.recordId, limit: 50 }),
          ]);
        } else {
          screen.record = null;
          screen.signals = [];
        }
        break;
      case "account":
      case "person":
      case "opportunity":
      case "records":
        screen.records = await queryCrmRecords(
          {
            // /records defaults to the accounts tab when the URL names no kind.
            kind:
              navigation.view === "records"
                ? (selection.kind ?? "account")
                : navigation.view,
            ...(selection.query ? { query: selection.query } : {}),
            ...(selection.viewId ? { viewId: selection.viewId } : {}),
            limit: 50,
          },
          { actorEmail },
        );
        break;
      case "lists":
        screen.lists = await visibleLists();
        break;
      case "views":
      case "board":
        screen.savedViews = await listCrmSavedViews({ limit: 50 });
        if (selection.viewId) {
          const view = await loadCrmSavedView(selection.viewId);
          screen.activeView = view;
          screen.records = await queryCrmRecords(
            { viewId: view.id, limit: 50 },
            { actorEmail },
          );
        } else if (selection.listId) {
          // null distinguishes "a list is selected but not visible to you"
          // from "no list is selected", which `selection.listId` still shows.
          screen.activeList = await visibleList(selection.listId);
        }
        break;
      case "tasks":
        screen.tasks = await listCrmTasks({ limit: 50 });
        break;
      case "proposals":
        screen.proposals = await listCrmProposals({ limit: 50 });
        break;
      case "dashboard":
        {
          const dashboards = await crmDashboardStore.list({
            userEmail: ctx?.userEmail,
            orgId: ctx?.orgId ?? undefined,
          });
          screen.dashboards = dashboards;
          screen.dashboard = selection.dashboardId
            ? (dashboards.find(
                (dashboard: { id: string }) =>
                  dashboard.id === selection.dashboardId,
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

interface ResolvedSelection extends CrmNavigationSelection {
  recordId?: string;
  /** False when the UI published no path, so an absent field is unknown. */
  pathReadable: boolean;
}

/**
 * The fields the route hook publishes explicitly win; the rest come from the
 * visited path. `pathReadable` keeps "nothing selected" distinguishable from
 * "the UI never told us what is selected".
 */
function resolveSelection(
  navigation: {
    recordId?: string;
    viewId?: string;
    dashboardId?: string;
    query?: string;
    settingsSection?: string;
  } | null,
  parsed: CrmNavigationSelection | null,
): ResolvedSelection {
  const viewId = navigation?.viewId ?? parsed?.viewId;
  const dashboardId = navigation?.dashboardId ?? parsed?.dashboardId;
  const query = navigation?.query ?? parsed?.query;
  const settingsSection =
    (navigation?.settingsSection as CrmNavigationSelection["settingsSection"]) ??
    parsed?.settingsSection;
  return {
    pathReadable: parsed !== null,
    ...(navigation?.recordId ? { recordId: navigation.recordId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(parsed?.listId ? { listId: parsed.listId } : {}),
    ...(dashboardId ? { dashboardId } : {}),
    ...(parsed?.kind ? { kind: parsed.kind } : {}),
    ...(parsed?.mode ? { mode: parsed.mode } : {}),
    ...(query ? { query } : {}),
    ...(settingsSection ? { settingsSection } : {}),
  };
}

const LIST_COLUMNS = {
  id: schema.crmLists.id,
  connectionId: schema.crmLists.connectionId,
  name: schema.crmLists.name,
  apiSlug: schema.crmLists.apiSlug,
  description: schema.crmLists.description,
  parentObjectType: schema.crmLists.parentObjectType,
  defaultViewId: schema.crmLists.defaultViewId,
  archived: schema.crmLists.archived,
  position: schema.crmLists.position,
};

async function visibleLists() {
  return getDb()
    .select(LIST_COLUMNS)
    .from(schema.crmLists)
    .where(
      and(
        eq(schema.crmLists.archived, false),
        accessFilter(schema.crmLists, schema.crmListShares),
      ),
    )
    .orderBy(asc(schema.crmLists.position), asc(schema.crmLists.createdAt))
    .limit(50);
}

async function visibleList(listId: string) {
  const [list] = await getDb()
    .select(LIST_COLUMNS)
    .from(schema.crmLists)
    .where(
      and(
        eq(schema.crmLists.id, listId),
        accessFilter(schema.crmLists, schema.crmListShares),
      ),
    )
    .limit(1);
  return list ?? null;
}

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
