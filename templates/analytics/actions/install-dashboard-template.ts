import { defineAction, embedApp } from "@agent-native/core";
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
import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";

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

export default defineAction({
  description:
    "Install a dashboard template from the Analytics catalog into the user's SQL-backed dashboards. Use list-dashboard-templates first when choosing a template.",
  schema: z.object({
    templateId: z
      .string()
      .describe("Catalog template id from list-dashboard-templates"),
    dashboardId: z
      .string()
      .optional()
      .describe(
        "Optional dashboard id to write. Omit to reuse an existing installed copy or create a unique id.",
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
