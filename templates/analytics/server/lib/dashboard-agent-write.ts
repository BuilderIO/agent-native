import { fail, type WriteReceipt } from "@agent-native/core/action";

import { clipHead } from "../../shared/panel-render-contract";
import {
  describePanelOutcome,
  type PanelWriteVerdict,
} from "./dashboard-panel-verification";
import {
  assertDashboardEditable,
  type DashboardRecord,
} from "./dashboards-store";

const RECEIPT_SUMMARY_CHARS = 200;
const RECEIPT_DETAIL_CHARS = 160;
// The agent loop keeps the first 8 checks of a receipt.
const RECEIPT_MAX_CHECKS = 8;

/**
 * Panel titles and column names reach a model-visible retry message, so a
 * receipt carries them as one line with no tag or control characters.
 */
function oneLine(text: string, max: number): string {
  const clean = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\p{Cf}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clipHead(clean, max - 1)}…` : clean;
}

/**
 * Panel SQL runs the caller's credentials, so every write path proves the
 * caller can edit the dashboard before it validates, dry-runs or verifies a
 * single panel. `upsertDashboard` keeps its own check as the backstop.
 */
export async function requireEditableDashboard(
  dashboardId: string,
  ctx: { email: string; orgId: string | null },
  existing: DashboardRecord | null,
): Promise<DashboardRecord> {
  if (!existing) {
    fail(`dashboard "${dashboardId}" not found (or you don't have access).`, {
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
  }
  try {
    await assertDashboardEditable(dashboardId, ctx);
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { statusCode?: number }).statusCode === 403
    ) {
      fail(err.message, { errorCode: "dashboard_forbidden", statusCode: 403 });
    }
    throw err;
  }
  return existing;
}

/**
 * An agent write that left the dashboard exactly as it was. `changed: false`
 * makes the loop have the model say so instead of calling the edit done; a
 * later verified change to the same dashboard supersedes it.
 */
export function dashboardNoopReceipt(dashboardId: string): WriteReceipt {
  return {
    changed: false,
    verified: "unverified",
    subject: dashboardId,
    summary: oneLine(
      `Nothing was written to "${dashboardId}": it already matched the requested state.`,
      RECEIPT_SUMMARY_CHARS,
    ),
  };
}

/**
 * What an agent write proved, for the loop's final-answer guard. `saved` is
 * the leading clause ("Saved 2 op(s) to \"growth\""). There is one check per
 * verified panel, named by its panel id, so a later write can clear an earlier
 * flagged one only by checking the same panels. Failing checks come first so
 * the receipt's check cap never drops the reason; a write whose panels were
 * not checked is `unverified`, never a clean pass.
 */
export function dashboardWriteReceipt(
  dashboardId: string,
  saved: string,
  verdict: PanelWriteVerdict | null,
): WriteReceipt {
  const base = { changed: true, subject: dashboardId };
  const summary = (text: string) => oneLine(text, RECEIPT_SUMMARY_CHARS);
  if (verdict?.noRenderAffected) {
    // No checks: this save proved nothing about any panel, so the loop must not
    // let it stand in for a check of an earlier flagged write.
    return {
      ...base,
      verified: true,
      summary: summary(
        `${saved}; no panel render was affected, so no panel was checked.`,
      ),
    };
  }
  const panels = verdict?.verification?.panels ?? [];
  const visualCount = verdict?.visualOnly?.length ?? 0;
  if (!verdict || (panels.length === 0 && visualCount === 0)) {
    return {
      ...base,
      verified: "unverified",
      summary: summary(
        `${saved} but its panels were not checked${verdict?.nextStep ? `: ${verdict.nextStep}` : "."}`,
      ),
    };
  }
  // A section or extension edit is seen by the viewer but has no data to check.
  const notDataChecked =
    visualCount > 0
      ? `${visualCount} section/extension panel(s) not data-checked (config only); `
      : "";
  const rendered = panels.filter((panel) => !panel.visualOnly);
  const rows = panels
    .map((panel) => ({
      title: panel.title,
      id: oneLine(panel.panelId, RECEIPT_DETAIL_CHARS),
      ok: panel.status === "ok" && panel.staticIssues.length === 0,
      detail: oneLine(describePanelOutcome(panel), RECEIPT_DETAIL_CHARS),
    }))
    .sort((a, b) => Number(a.ok) - Number(b.ok));
  const failing = rows.filter((row) => !row.ok);
  const checks = rows.map(({ id, ok, detail }) => ({ id, ok, detail }));
  // Panels the cap would hide stay visible as one failing check that no later
  // write can clear, instead of vanishing from the receipt.
  const hidden = failing.length - (RECEIPT_MAX_CHECKS - 1);
  return {
    ...base,
    verified: verdict.verified,
    summary: summary(
      failing.length === 0
        ? `${saved}; ${notDataChecked}${
            rendered.length > 0
              ? `${rendered.length} panel(s) verified rendering: ${rendered
                  .slice(0, 3)
                  .map((panel) => `"${panel.title}"`)
                  .join(", ")}.`
              : "no data panel was affected."
          }`
        : `${saved} but NOT verified: ${failing
            .slice(0, 2)
            .map((row) => `"${row.title}" ${row.detail}`)
            .join("; ")}.`,
    ),
    checks:
      hidden > 1
        ? [
            ...checks.slice(0, RECEIPT_MAX_CHECKS - 1),
            {
              id: `${hidden} more unverified panels`,
              ok: false,
              detail: "not listed: more panels failed than a receipt can name",
            },
          ]
        : checks.slice(0, RECEIPT_MAX_CHECKS),
  };
}
