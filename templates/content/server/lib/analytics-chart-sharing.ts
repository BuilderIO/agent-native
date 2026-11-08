import { fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import type { EmbedVisibility } from "@agent-native/core/shared";

import { analyticsChartsWiderThan } from "../../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../../shared/analytics-charts-in-body.js";

/**
 * Refuses to open a page to `visibility` when a table it holds would reach
 * more people than the table's dashboard. Charts and metrics only warn, in
 * the share dialog; tables list rows about named customers and accounts.
 */
export async function assertAnalyticsTablesFitAudience(
  content: unknown,
  visibility: EmbedVisibility,
): Promise<void> {
  if (visibility === "private" || typeof content !== "string") return;
  const { block } = analyticsChartsWiderThan(
    visibility,
    await analyticsChartsInBody(content),
  );
  if (block.length === 0) return;
  const titles = [...new Set(block.map((chart) => chart.dashboard.title))];
  fail(
    `This page has ${block.length === 1 ? "a table" : `${block.length} tables`} from ${titles.length === 1 ? `the ${titles[0]} dashboard` : `the ${titles.join(", ")} dashboards`}, which fewer people can open. A table can't reach more people than its dashboard. Remove it, or share the dashboard more widely in Analytics first.`,
    { errorCode: "analytics_table_wider_than_dashboard", statusCode: 409 },
  );
}

type SharingChangeResource =
  | { id?: unknown; content?: unknown; visibility?: unknown }
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

/**
 * The page sharing hook's check, against the page's current body. A share
 * with a person or group can reach people the dashboard doesn't, so it
 * counts as at least the whole organization.
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
  await assertAnalyticsTablesFitAudience(
    await savedBody(resource),
    change.kind === "visibility"
      ? change.visibility
      : resource?.visibility === "public"
        ? "public"
        : "org",
  );
}
