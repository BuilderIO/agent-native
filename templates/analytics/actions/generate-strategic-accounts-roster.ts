import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { runQuery } from "../server/lib/bigquery";
import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import {
  listStrategicAccounts,
  replaceStrategicAccounts,
} from "../server/lib/strategic-accounts-store";

/**
 * Derives the Strategic Accounts roster LIVE from the warehouse so a fresh
 * deployment can self-populate without any hardcoded account names. Ranks
 * enterprise companies by distinct active Fusion users over a recent window,
 * takes the top N, writes them to the org-scoped `strategic_accounts` table,
 * and syncs the dashboard's `accounts` variable so the metrics panels reflect
 * the new roster immediately.
 *
 * Warehouse tables mirror the existing Strategic Accounts dashboard panels:
 *   - builder-3b0a2.dbt_mart.enterprise_companies (company_name, root_org_id)
 *   - builder-3b0a2.amplitude.EVENTS_182198 (event_type, event_time, user_id,
 *     event_properties.$.rootOrganizationId)
 */

function clampInt(
  raw: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function buildRosterSql(limit: number, windowDays: number): string {
  // limit/windowDays are validated integers (clampInt) so they are safe to
  // inline — no string interpolation of user text reaches the SQL.
  return `WITH usage AS (
  SELECT ec.company_name AS company_name,
         COUNT(DISTINCT e.user_id) AS active_users
  FROM \`builder-3b0a2.amplitude.EVENTS_182198\` e
  JOIN \`builder-3b0a2.dbt_mart.enterprise_companies\` ec
    ON ec.root_org_id = JSON_VALUE(e.event_properties, '$.rootOrganizationId')
  WHERE e.event_type = 'fusion chat message submitted'
    AND DATE(e.event_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${windowDays} DAY)
    AND ec.company_name IS NOT NULL
    AND TRIM(ec.company_name) != ''
  GROUP BY company_name
)
SELECT company_name, active_users
FROM usage
ORDER BY active_users DESC, company_name ASC
LIMIT ${limit}`;
}

async function syncDashboardVariable(
  accountsPipe: string,
  ctx: { email: string; orgId: string | null },
): Promise<boolean> {
  try {
    const existing = await getDashboard("strategic-accounts", ctx);
    if (!existing) return false;
    const config = existing.config as Record<string, unknown>;
    const variables =
      config.variables && typeof config.variables === "object"
        ? (config.variables as Record<string, unknown>)
        : {};
    config.variables = { ...variables, accounts: accountsPipe };
    await upsertDashboard("strategic-accounts", existing.kind, config, ctx);
    return true;
  } catch {
    // Best-effort: roster write is the source of truth. If the dashboard
    // doesn't exist yet (fresh install before it's created), skip silently.
    return false;
  }
}

export default defineAction({
  description:
    "Generate the Strategic Accounts roster LIVE from the warehouse (no hardcoding). Ranks enterprise companies by distinct active Fusion users over a recent window, takes the top N, replaces the org's `strategic_accounts` roster in one atomic write, and syncs the dashboard's `accounts` variable. Use this to bootstrap the roster on a fresh deployment or to refresh it. Set `dryRun: true` to preview the ranked list without writing.",
  schema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("How many top accounts to include (default 25)."),
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Activity window in days for ranking (default 90)."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Preview the ranked roster without writing (default false)."),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId };

    const limit = clampInt(args.limit, 1, 200, 25);
    const windowDays = clampInt(args.windowDays, 1, 365, 90);

    const result = await runQuery(buildRosterSql(limit, windowDays));
    const rows = (result?.rows ?? []) as Array<Record<string, unknown>>;
    const ranked = rows
      .map((r) => ({
        companyName: String(r.company_name ?? "").trim(),
        activeUsers: Number(r.active_users ?? 0),
      }))
      .filter((r) => r.companyName !== "");

    const accountsPipe = ranked.map((r) => r.companyName).join("|");

    if (args.dryRun) {
      return {
        ok: true,
        dryRun: true,
        count: ranked.length,
        windowDays,
        limit,
        accounts: ranked,
        accountsPipe,
        summary: `Preview: ${ranked.length} account(s) ranked by active Fusion users over ${windowDays}d. Nothing written.`,
      };
    }

    // Preserve manually-curated fields (companyId, deploymentStatus, notes) for
    // companies that already exist — the warehouse ranking only knows the name,
    // so a blind replace would silently wipe human-entered metadata.
    const existing = await listStrategicAccounts(ctx);
    const priorByName = new Map(
      existing.map((a) => [a.companyName.trim().toLowerCase(), a]),
    );
    const written = await replaceStrategicAccounts(
      ranked.map((r, i) => {
        const prior = priorByName.get(r.companyName.toLowerCase());
        return {
          companyName: r.companyName,
          sortOrder: i,
          companyId: prior?.companyId ?? null,
          deploymentStatus: prior?.deploymentStatus ?? "",
          notes: prior?.notes ?? "",
        };
      }),
      ctx,
    );
    const dashboardSynced = await syncDashboardVariable(accountsPipe, ctx);

    return {
      ok: true,
      count: written.length,
      windowDays,
      limit,
      dashboardSynced,
      accounts: written,
      accountsPipe,
      summary: `Generated Strategic Accounts roster from the warehouse: ${written.length} account(s) by active Fusion users over ${windowDays}d.${dashboardSynced ? " Dashboard variable synced." : ""}`,
      urlPath: "/dashboards/strategic-accounts",
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: "strategic-accounts" },
      }),
    };
  },
});
