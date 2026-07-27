import { defineAction, embedApp } from "@agent-native/core";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  applyCatalogMetadata,
  cloneDashboardConfig,
  generateDashboardId,
  getDashboardCatalogEntry,
  listDashboardCatalog,
} from "../server/lib/dashboard-catalog";
import {
  getDashboard,
  upsertDashboard,
  upsertDashboardWithRetry,
  type DashboardRecord,
} from "../server/lib/dashboards-store";

async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    if (await hasCollabState(docId)) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // SQL is the source of truth; collab state can seed lazily later.
  }
}

function uniqueConstraintMessage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /unique|constraint|primary key/i.test(message);
}

function filterId(filter: unknown): string | null {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    return null;
  }
  const id = (filter as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function mergeMissingFilters(
  targetConfig: Record<string, unknown>,
  seedConfig: Record<string, unknown>,
): { config: Record<string, unknown>; addedFilterIds: string[] } {
  const seedFilters = Array.isArray(seedConfig.filters)
    ? (seedConfig.filters as unknown[])
    : [];
  if (seedFilters.length === 0) {
    return { config: targetConfig, addedFilterIds: [] };
  }

  const targetFilters = Array.isArray(targetConfig.filters)
    ? [...targetConfig.filters]
    : [];
  const existingIds = new Set(
    targetFilters
      .map((filter) => filterId(filter))
      .filter((id): id is string => id !== null),
  );
  const addedFilterIds: string[] = [];
  for (const filter of seedFilters) {
    const id = filterId(filter);
    if (id && existingIds.has(id)) continue;
    targetFilters.push(filter);
    if (id) {
      existingIds.add(id);
      addedFilterIds.push(id);
    }
  }

  return addedFilterIds.length > 0
    ? { config: { ...targetConfig, filters: targetFilters }, addedFilterIds }
    : { config: targetConfig, addedFilterIds };
}

export default defineAction({
  description:
    "Install a dashboard template from the Analytics catalog into the user's SQL-backed dashboards. Use list-dashboard-templates first when choosing a template. " +
    "To ADD a template's panels to an EXISTING dashboard in ONE call (the preferred way to bulk-add panels), pass `mergePanels: true` with the `dashboardId` of the existing dashboard: it appends every template panel whose id is not already present, preserves all existing panels and their order, and saves once. This avoids looping update-dashboard, which times out on the ~40s hosted run budget.",
  schema: z.object({
    templateId: z
      .string()
      .describe("Catalog template id from list-dashboard-templates"),
    dashboardId: z
      .string()
      .optional()
      .describe(
        "Optional dashboard id to write. Omit to reuse an existing installed copy or create a unique id. Required when mergePanels is true.",
      ),
    name: z
      .string()
      .optional()
      .describe("Optional installed dashboard name override"),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "If true, replace an existing accessible dashboard at dashboardId.",
      ),
    forceNew: z
      .boolean()
      .optional()
      .describe(
        "If true, create another copy even when this template is installed.",
      ),
    mergePanels: z
      .boolean()
      .optional()
      .describe(
        "If true AND a dashboard already exists at dashboardId, APPEND this template's panels (only the ones whose id is not already present) to the existing dashboard in one atomic save, preserving all existing panels and their order. Returns { addedPanelIds, skippedExistingIds, panelCount }. Non-destructive; does not change overwrite/forceNew behavior.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Installed dashboard",
      description: "Open the installed dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 760,
    }),
  },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };

    const entry = getDashboardCatalogEntry(args.templateId);
    if (!entry)
      throw new Error(`Unknown dashboard template: ${args.templateId}`);

    // Append/merge mode: add this template's panels to an existing dashboard
    // in ONE atomic save instead of looping update-dashboard (which times out
    // on the ~40s hosted run budget). Non-destructive: existing panels and
    // their order are preserved; only template panels with a new id are added.
    //
    // This is a genuine read-modify-write of an EXISTING dashboard (an agent
    // merging a template while a human drags a panel, or two merge calls
    // racing), so the save is fenced through `upsertDashboardWithRetry`.
    // `computeMerge` is invoked with the freshest `DashboardRecord` on every
    // attempt and recomputes `existingIds`/`appended`/`mergedConfig` from
    // THAT record's config — never from a closure over the earlier `target`
    // read — so a lost race re-merges against whatever the concurrent writer
    // actually saved instead of clobbering it. `seedConfig`/`seedPanels` are
    // the template's own panels and don't depend on dashboard state, so they
    // are computed once outside the retry loop.
    if (args.mergePanels) {
      const targetId = args.dashboardId?.trim();
      if (!targetId) {
        throw new Error(
          "mergePanels=true requires dashboardId (the existing dashboard to append the template's panels to).",
        );
      }

      const target = await getDashboard(targetId, ctx);
      if (!target) {
        throw new Error(
          `Dashboard "${targetId}" not found (or you don't have access). mergePanels appends to an existing dashboard — install the template normally first, or omit mergePanels to create a new copy.`,
        );
      }

      const seedConfig = cloneDashboardConfig(entry) as unknown as Record<
        string,
        unknown
      >;
      const seedPanels = Array.isArray(seedConfig.panels)
        ? (seedConfig.panels as unknown as Array<Record<string, unknown>>)
        : [];

      function computeMerge(existing: Pick<DashboardRecord, "config">) {
        const targetConfig = existing.config as Record<string, unknown>;
        const existingPanels = Array.isArray(targetConfig.panels)
          ? (targetConfig.panels as Array<Record<string, unknown>>)
          : [];
        const existingIds = new Set(
          existingPanels
            .map((panel) => (typeof panel?.id === "string" ? panel.id : null))
            .filter((id): id is string => !!id),
        );

        const addedPanelIds: string[] = [];
        const skippedExistingIds: string[] = [];
        const appended: Array<Record<string, unknown>> = [];
        for (const panel of seedPanels) {
          const id = typeof panel?.id === "string" ? panel.id : null;
          if (id && existingIds.has(id)) {
            skippedExistingIds.push(id);
            continue;
          }
          appended.push(panel);
          if (id) {
            addedPanelIds.push(id);
            existingIds.add(id);
          }
        }

        let mergedConfig: Record<string, unknown> = {
          ...targetConfig,
          panels: [...existingPanels, ...appended],
        };
        const filterMerge = mergeMissingFilters(mergedConfig, seedConfig);
        mergedConfig = filterMerge.config;

        return {
          mergedConfig,
          addedPanelIds,
          skippedExistingIds,
          appended,
          filterMerge,
        };
      }

      let computed = computeMerge(target);
      let savedTitle = target.title;

      if (
        computed.appended.length > 0 ||
        computed.filterMerge.addedFilterIds.length > 0
      ) {
        const saved = await upsertDashboardWithRetry(
          targetId,
          ctx,
          (existing) => {
            computed = computeMerge(existing);
            return { kind: existing.kind, body: computed.mergedConfig };
          },
        );
        await syncToCollab(targetId, saved.config as Record<string, unknown>);
        savedTitle = saved.title;
      }

      const panelCount = (computed.mergedConfig.panels as unknown[]).length;

      return {
        templateId: entry.id,
        templateName: entry.name,
        dashboardId: targetId,
        name: savedTitle,
        merged: true,
        addedPanelIds: computed.addedPanelIds,
        skippedExistingIds: computed.skippedExistingIds,
        panelCount,
        urlPath: `/dashboards/${targetId}`,
        deepLink: buildDeepLink({
          app: "analytics",
          view: "adhoc",
          params: { dashboardId: targetId },
        }),
        message:
          computed.appended.length > 0
            ? `Added ${computed.addedPanelIds.length} panel(s) from "${entry.name}" to "${savedTitle}"; ${computed.skippedExistingIds.length} already present. Dashboard now has ${panelCount} panel(s).`
            : `No new panels to add from "${entry.name}" — all ${computed.skippedExistingIds.length} template panel id(s) already present. Dashboard has ${panelCount} panel(s).`,
      };
    }

    const installed = (await listDashboardCatalog(ctx)).find(
      (template) => template.id === entry.id,
    );
    const existingInstall = installed?.installedDashboards[0];
    if (existingInstall && !args.forceNew && !args.dashboardId) {
      return {
        templateId: entry.id,
        dashboardId: existingInstall.id,
        name: existingInstall.name,
        alreadyInstalled: true,
        urlPath: `/dashboards/${existingInstall.id}`,
        deepLink: buildDeepLink({
          app: "analytics",
          view: "adhoc",
          params: { dashboardId: existingInstall.id },
        }),
        message: `Template "${entry.name}" is already installed as "${existingInstall.name}".`,
      };
    }

    const dashboardId = args.dashboardId?.trim() || generateDashboardId(entry);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(dashboardId)) {
      throw new Error(
        "dashboardId must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
      );
    }

    const existing = await getDashboard(dashboardId, ctx);
    if (existing && !args.overwrite) {
      throw new Error(
        `Dashboard "${dashboardId}" already exists. Pass overwrite=true to replace it or omit dashboardId to create a new copy.`,
      );
    }

    const config = applyCatalogMetadata(entry, cloneDashboardConfig(entry));
    if (args.name?.trim()) config.name = args.name.trim();
    const dashboardConfig = config as unknown as Record<string, unknown>;

    try {
      const dashboard = await upsertDashboard(
        dashboardId,
        "sql",
        dashboardConfig,
        ctx,
      );
      await syncToCollab(dashboardId, dashboardConfig);

      return {
        templateId: entry.id,
        templateName: entry.name,
        dashboardId,
        name: dashboard.title,
        alreadyInstalled: false,
        overwritten: !!existing,
        urlPath: `/dashboards/${dashboardId}`,
        deepLink: buildDeepLink({
          app: "analytics",
          view: "adhoc",
          params: { dashboardId },
        }),
        message: `Installed "${entry.name}" as "${dashboard.title}".`,
      };
    } catch (err) {
      if (uniqueConstraintMessage(err)) {
        throw new Error(
          `Dashboard id "${dashboardId}" is already in use. Omit dashboardId or choose a different one.`,
        );
      }
      throw err;
    }
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string }).dashboardId
        : undefined;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open installed dashboard",
      view: "adhoc",
    };
  },
});
