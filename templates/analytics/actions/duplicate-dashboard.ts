import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  listDashboardSummaries,
  normalizeDashboardName,
  upsertDashboard,
} from "../server/lib/dashboards-store";
import { openDashboard } from "../server/lib/open-dashboard";

function copyName(title: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${title} (copy)` : `${title} (copy ${n})`;
    if (!taken.has(normalizeDashboardName(name))) return name;
  }
}

export default defineAction({
  description:
    "Duplicate a SQL dashboard into a new private dashboard the caller owns and can edit. " +
    "Use this to customize a built-in dashboard, which is read-only: the copy keeps every panel, filter and layout, drops the built-in's install metadata, and no longer changes when the app ships. " +
    "Returns the new dashboard's id; edit it with update-dashboard.",
  schema: z.object({
    id: z.string().min(1).describe("The dashboard to duplicate"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Name for the copy. Defaults to "<name> (copy)".'),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to duplicate a dashboard.", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }
    const ctx = { email, orgId: getRequestOrgId() || null };

    const opened = await openDashboard(args.id, ctx);
    const row = opened?.saved;
    const builtin = opened?.builtin;
    const source = builtin
      ? { id: builtin.id, title: builtin.title, config: builtin.config }
      : row?.kind === "sql"
        ? { id: row.id, title: row.title, config: row.config }
        : null;
    if (!source) fail("Dashboard not found.", { statusCode: 404 });

    const {
      catalog: _catalog,
      demo: _demo,
      parentId: _parentId,
      ...config
    } = source.config;
    const taken = new Set(
      (await listDashboardSummaries(ctx, { legacyScan: "strict" })).map(
        (dashboard) => normalizeDashboardName(dashboard.name),
      ),
    );
    const name = args.name ?? copyName(source.title, taken);
    const id = `sql-dashboard-${randomUUID()}`;
    const copy = await upsertDashboard(
      id,
      "sql",
      {
        ...config,
        name,
        copiedFrom: {
          id: source.id,
          ...(builtin ? { builtinVersion: builtin.version } : {}),
          copiedAt: new Date().toISOString(),
        },
      },
      ctx,
    );
    return { id: copy.id, name: copy.title, copiedFrom: source.id };
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
      label: "Open the copy in Analytics",
      view: "adhoc",
    };
  },
});
