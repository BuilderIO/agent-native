import type { Page } from "@playwright/test";

import { checkDemoMonthlySql } from "../demo-sql.js";
import { checkHomeCreateCollection } from "../home-create-collection.js";
import { checkHomeIntentTransport } from "../home-intent.js";
import { checkNotifications } from "../notifications.js";
import { checkSearchFilters } from "../search-filters.js";
import { checkDataFavoritesLive } from "./data-favorites.js";
import { checkQueryErrorReloadLive } from "./query-error-reload.js";
import { assertQaIdentity } from "./shared.js";
import {
  checkPagerEmptyContinuationLive,
  checkQueryCancellationLive,
} from "./transport.js";

type LiveCheck = (page: Page, base: string) => Promise<void>;

const withIdentity =
  (check: LiveCheck): LiveCheck =>
  async (page, base) => {
    await assertQaIdentity(page, base);
    await check(page, base);
  };

export const liveFixtureFlows = {
  "steve-demo-monthly-revenue": withIdentity(checkDemoMonthlySql),
  "DATA-FAVORITES": checkDataFavoritesLive,
  "report-1794899542.541439-notifications": withIdentity(checkNotifications),
  "report-1794900229.518749-home-create-collection": withIdentity(
    checkHomeCreateCollection,
  ),
  "report-search-filters": withIdentity(checkSearchFilters),
  "report-F12-query-error-reload": checkQueryErrorReloadLive,
  "app-intent-transport": withIdentity(checkHomeIntentTransport),
  "query-cancellation-transport": checkQueryCancellationLive,
  "report-pager-empty-continuation": checkPagerEmptyContinuationLive,
} as const satisfies Record<string, LiveCheck>;

export const liveFixtureGaps: Record<string, string> = {
  "first-run-setup":
    "No create/delete-organization action exists in this app, and the QA account is already onboarded (firstRun is false); a fresh new-admin fixture cannot be created and removed through app actions",
  "report-1794899960.825799-home-app-intent":
    "Needs a controllable model transport; live QA uses the real model, so the Home app-intent send cannot be asserted deterministically",
  "query-error-cancel":
    "Needs a controllable pending BigQuery provider; creating a credentialed warehouse connection as a fixture is not allowed",
  "demo-dispatch-chart":
    "No Dispatch chart fixture exists; it needs a hosted Dispatch session this collector does not hold",
  "demo-mcp-chart":
    "No authenticated MCP client fixture exists in this collector",
  "billing-analysis-end-to-end":
    "Needs a second signed-in user; only the single QA account is permitted",
  "sql-editor-affordances":
    "The isolated local SQL review database is unavailable (ANALYTICS_SQL_REVIEW_DATABASE_URL is not set)",
};
