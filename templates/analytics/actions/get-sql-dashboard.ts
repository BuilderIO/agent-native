import { defineAction, embedApp, fail } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import type {
  DashboardAnnotations,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import {
  buildDashboardAgentContext,
  buildDashboardSeedAgentContext,
  isAgentContextCaller,
} from "../server/lib/agent-readable-resource-context";
import { repairKnownFirstPartyDashboardQueries } from "../server/lib/canonical-first-party-dashboard-repair";
import { loadDashboardAnnotationSummary } from "../server/lib/dashboard-annotation-reads";
import { storedDashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope";
import { dataNotesForReader } from "../server/lib/dashboard-data-notes";
import { getReviewedDashboard } from "../server/lib/dashboard-review-access";
import { listDataNotes } from "../server/lib/data-notes-store";
import { listKeyDateSets } from "../server/lib/key-dates-store";
import { openDashboard } from "../server/lib/open-dashboard";
import { drawsKeyDates, keyDateEvents } from "../shared/key-dates";

export default defineAction({
  description:
    "Get a SQL analytics dashboard by ID. By default this returns compact panel summaries (chart type, `bindings` naming the result columns each chart is bound to, SQL size and hash), layout/order fields, certification, and a `revision`, without SQL strings. Pass `panelIds` to get the full SQL and config of just those panels in `panelDetails`. Use includeConfig=true only to review the whole dashboard; past ~12k characters it returns summaries with `truncated: true` and `omittedPanelIds`.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    includeConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config including every panel's SQL. Defaults to false to keep agent context compact; prefer panelIds.",
      ),
    panelIds: z
      .array(z.string())
      .max(25)
      .optional()
      .describe(
        "Panel ids to return in full (SQL and config) under `panelDetails`; unknown ids come back in `missingPanelIds`. Every other panel stays a compact summary.",
      ),
    reviewPreview: z
      .boolean()
      .optional()
      .describe(
        "Human Review only: read a saved dashboard for an organization owner/admin. Cross-organization reads are limited to the single organization configured as this app's observability super organization.",
      ),
    reviewOrgId: z
      .string()
      .min(1)
      .optional()
      .describe("The customer organization shown in this Human Review row."),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: id },
      }),
      label: "Open dashboard in Analytics",
      view: "adhoc",
    };
  },
  run: async (args, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };

    const detail = {
      includeConfig: args.includeConfig === true,
      panelIds: args.panelIds,
      forAgent: isAgentContextCaller(actionContext?.caller),
      reviewPreview: args.reviewPreview === true,
    };

    const opened = args.reviewPreview
      ? null
      : await openDashboard(args.id, ctx);
    const dash = args.reviewPreview
      ? await getReviewedDashboard(args.id, orgId, args.reviewOrgId)
      : opened?.saved;
    const builtin = opened?.builtin;
    if (builtin) {
      // `id` is the built-in's, so a page opened at an old copy's id
      // can move to the built-in's URL.
      return {
        ...buildDashboardSeedAgentContext(builtin.id, builtin.config, {
          ...detail,
          annotationSummary: detail.forAgent
            ? await loadDashboardAnnotationSummary(
                { scope: ctx, editable: true },
                builtin.id,
                builtin.config,
              )
            : undefined,
        }),
        role: "viewer",
        canEdit: false,
        canManage: false,
        revision: builtin.version,
        builtin: { id: builtin.id, version: builtin.version },
        ...(builtin.id !== args.id ? { requestedId: args.id } : {}),
      };
    }
    if (!dash || dash.kind !== "sql") {
      fail("Dashboard not found.", { statusCode: 404 });
    }
    const dashboard = {
      ...dash,
      config: repairKnownFirstPartyDashboardQueries(args.id, dash.config)
        .config,
    };
    const annotationScope = storedDashboardAnnotationScope(dashboard, ctx);
    const context = buildDashboardAgentContext(dashboard, {
      ...detail,
      annotationSummary: detail.forAgent
        ? await loadDashboardAnnotationSummary(
            annotationScope,
            args.id,
            dashboard.config as Record<string, unknown>,
          )
        : undefined,
    });
    // The preview UI draws every record; an agent gets the bounded summary.
    if (!args.reviewPreview || detail.forAgent) return context;
    // The reviewer may be in another organization, so list-key-dates and
    // list-data-notes would return theirs, not the ones this dashboard draws.
    const [sets, notes] = await Promise.all([
      listKeyDateSets(annotationScope.scope),
      listDataNotes(annotationScope.scope),
    ]);
    const config = dashboard.config as {
      panels?: SqlPanel[];
      annotations?: DashboardAnnotations;
    };
    return {
      ...context,
      keyDates: drawsKeyDates(config.panels ?? [])
        ? keyDateEvents(sets, config.annotations)
        : [],
      dataNotes: dataNotesForReader(notes, dashboard),
    };
  },
});
