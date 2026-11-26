import { fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { isOrgMember } from "@agent-native/core/org";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import type { EmbedVisibility } from "@agent-native/core/shared";

import { analyticsChartsWiderThan } from "../../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../../shared/analytics-charts-in-body.js";

/**
 * Refuses to open a page to `audience` when a table it holds would reach
 * more people than the table's dashboard. Charts and metrics only warn, in
 * the share dialog; tables list rows about named customers and accounts.
 * Pass a function to work out the audience only for a page holding charts.
 */
export async function assertAnalyticsTablesFitAudience(
  content: unknown,
  audience: EmbedVisibility | (() => Promise<EmbedVisibility>),
): Promise<void> {
  if (typeof content !== "string") return;
  const { charts, unreadable } = await analyticsChartsInBody(content);
  if (charts.length === 0 && unreadable === 0) return;
  const visibility =
    typeof audience === "function" ? await audience() : audience;
  if (visibility === "private") return;
  const { block } = analyticsChartsWiderThan(visibility, charts);
  if (block.length === 0) {
    if (unreadable === 0) return;
    fail(
      "This page has an Analytics chart that can't be read, so there's no telling who may see its numbers. Remove it, or add it again from Analytics.",
      { errorCode: "analytics_chart_unreadable", statusCode: 409 },
    );
  }
  const titles = [...new Set(block.map((chart) => chart.dashboard.title))];
  fail(
    `This page has ${block.length === 1 ? "a table" : `${block.length} tables`} from ${titles.length === 1 ? `the ${titles[0]} dashboard` : `the ${titles.join(", ")} dashboards`}, which fewer people can open. A table can't reach more people than its dashboard. Remove it, or share the dashboard more widely in Analytics first.`,
    { errorCode: "analytics_table_wider_than_dashboard", statusCode: 409 },
  );
}

const AUDIENCE_RANK: Record<EmbedVisibility, number> = {
  private: 0,
  org: 1,
  public: 2,
};

/** The wider of two audiences. */
export function widerAudience(
  a: EmbedVisibility,
  b: EmbedVisibility,
): EmbedVisibility {
  return AUDIENCE_RANK[a] >= AUDIENCE_RANK[b] ? a : b;
}

/**
 * Who a page's shares reach. A share with someone outside the organization,
 * with another organization, or with anyone who has the link reaches past
 * it, so it counts as public; one with a colleague or one of the
 * organization's groups counts as the organization. The organization is the
 * page's, or for a page outside one (a personal page) the caller's current
 * organization, the one its charts were captured from.
 */
export async function sharesAudience(
  pageOrgId: string | null | undefined,
  shares: readonly { principalType: string; principalId: string }[],
): Promise<EmbedVisibility> {
  if (shares.length === 0) return "private";
  const orgId = pageOrgId || getRequestOrgId();
  let audience: EmbedVisibility = "private";
  for (const { principalType, principalId } of shares) {
    // Core only shares with groups from the page's own organization.
    const inOrg =
      principalType === "group" ||
      (orgId
        ? principalType === "org"
          ? principalId === orgId
          : principalType === "user" && (await isOrgMember(orgId, principalId))
        : false);
    if (!inOrg) return "public";
    audience = "org";
  }
  return audience;
}

type SharingChangeResource =
  | { id?: unknown; content?: unknown; visibility?: unknown; orgId?: unknown }
  | null
  | undefined;

/**
 * The page's body as saved now. The row a sharing change loaded can be
 * older, and a table saved since would slip past it. Read through the
 * caller's transaction when there is one, as core's share writes are.
 */
async function savedBody(resource: SharingChangeResource): Promise<unknown> {
  if (typeof resource?.id !== "string") return resource?.content;
  // guard:allow-unscoped — reads the body of the page whose sharing is changing, after that change's own admin check.
  const { rows } = await getDbExec().execute({
    sql: "SELECT content FROM documents WHERE id = $1",
    args: [resource.id],
  });
  const row = rows[0];
  return row ? row.content : resource.content;
}

/** Who the page's shares reach now, read as `savedBody` reads. */
async function savedSharesAudience(
  resource: SharingChangeResource,
): Promise<EmbedVisibility> {
  if (typeof resource?.id !== "string") return "private";
  // guard:allow-unscoped � reads the shares of the page whose sharing is changing, after that change's own admin check.
  const { rows } = await getDbExec().execute({
    sql: "SELECT principal_type, principal_id FROM document_shares WHERE resource_id = $1",
    args: [resource.id],
  });
  return sharesAudience(
    typeof resource.orgId === "string" ? resource.orgId : null,
    rows.map((row) => ({
      principalType: String(row.principal_type),
      principalId: String(row.principal_id),
    })),
  );
}

/**
 * The page sharing hook's check, against the page's current body. A grant
 * is checked against who the page's shares reach once it is written: core
 * runs this hook again after the write, and undoes the grant if it fails.
 */
export async function assertAnalyticsTablesFitSharingChange({
  resource,
  change,
}: {
  resource: SharingChangeResource;
  change:
    | { kind: "visibility"; visibility: EmbedVisibility }
    | { kind: "grant" };
}): Promise<void> {
  if (change.kind === "visibility") {
    await assertAnalyticsTablesFitAudience(
      await savedBody(resource),
      change.visibility,
    );
    return;
  }
  // Before the write the new share isn't saved yet, so a grant counts as at
  // least the organization; after it, the saved shares say who it reached.
  await assertAnalyticsTablesFitAudience(await savedBody(resource), async () =>
    widerAudience(
      resource?.visibility === "public" ? "public" : "org",
      await savedSharesAudience(resource),
    ),
  );
}
