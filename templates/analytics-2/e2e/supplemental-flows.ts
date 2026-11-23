import { mkdir } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { checkSqlEditorHeight } from "../app/components/notebook/notebook.sql-height.e2e.js";
import { checkAutosaveRun } from "./autosave-run.js";
import { checkControlInventory } from "./control-inventory.js";
import { checkNotebookDataBrowserDialog } from "./data-browser-dialog.js";
import { checkDefaultConnection } from "./default-connection.js";
import { checkHomeRecovery } from "./home-recovery.js";
import { checkInputAdjacent } from "./input-adjacent-flow.js";
import { checkInputConfig } from "./input-config.js";
import { checkInputMenu } from "./input-menu.js";
import { checkInputQuery } from "./input-query.js";
import { checkInputSqlLiteral } from "./input-sql-literal.js";
import { checkLibrary } from "./library.js";
import { liveFixtureFlows, liveFixtureGaps } from "./live-fixtures/index.js";
import { LiveFixtureUnavailable } from "./live-fixtures/transport.js";
import { checkMenuViewport } from "./menu-viewport.js";
import { checkNotebookTablePreview } from "./notebook-data-preview.js";
import { checkCollectionDialog } from "./organize-collection-flows.js";
import {
  checkBrowseDataCatalog,
  checkCellReorder,
  checkDownloadCsv,
  checkParameterQuery,
  checkChainedSqlCell,
  checkMarkdownTextCells,
  checkNotebookKeyboardShortcuts,
  checkPublishDashboard,
  checkChartFormatting,
  checkRefineChart,
} from "./predicted-notebook-flows.js";
import { checkProjectMetaPickers } from "./project-meta-pickers.js";
import { checkProjectListColumns } from "./projects-list-columns.js";
import { checkPublishedStyles } from "./published-chart-styles.js";
import { checkPublishedDateRange } from "./published-date-range.js";
import { checkHistorySaveVersionKeyboard } from "./qa2-history-flows.js";
import { checkPublishDialogOpenState } from "./qa2-publish-flows.js";
import { sharePanelStagesInvitesWithoutSending } from "./qa2-sharing-flows.js";
import { checkQueryErrorCancel } from "./query-error-cancel.js";
import {
  checkCellDeleteImmediate,
  checkSavedResultPaging,
} from "./result-and-delete-flows.js";
import { checkSampleRerun } from "./sample-rerun.js";
import { checkSampleSqlEdgeCases } from "./sample-sql-edge-cases.js";
import { checkSayaSqlBasic } from "./saya-cells.js";
import { checkSignedInLandingRoutes } from "./signed-in-landing-routes.js";
import { checkPublishedAppSearch } from "./search-published-app.js";
import { checkSqlAgentReview } from "./sql-agent-review.js";
import { checkSqlConnectedSourceUi } from "./sql-connected-source-ui.js";
import { checkVersionHistoryRestore } from "./version-history-flow.js";

export { supplementalFlowNames } from "./supplemental-flow-names.js";
import type { SupplementalFlowName } from "./supplemental-flow-names.js";
export type { SupplementalFlowName } from "./supplemental-flow-names.js";
export type SupplementalResult =
  | { status: "pass" }
  | { status: "unavailable"; reason: string };

const implemented: Partial<
  Record<SupplementalFlowName, (page: Page, base: string) => Promise<void>>
> = {
  "report-127-home-recovery": checkHomeRecovery,
  "signed-in-landing-routes": checkSignedInLandingRoutes,
  "report-A2-AUTOSAVE-RUN-DROPPED": checkAutosaveRun,
  "report-B-SAMPLE-RERUN-CANCELLATION-TOAST": checkSampleRerun,
  "sample-sql-edge-cases": checkSampleSqlEdgeCases,
  "report-QA-1795062135-project-status-categories": checkProjectMetaPickers,
  "report-1795065529-sql-height": checkSqlEditorHeight,
  "report-1795063839-data-browser-dialog": checkNotebookDataBrowserDialog,
  "report-A2-ASK84-CUSTOM-DATE-RANGE": checkPublishedDateRange,
  "report-A2-PUBLISHED-CHART-STYLES": checkPublishedStyles,
  "control-inventory": checkControlInventory,
  "menu-viewport": checkMenuViewport,
  "report-1795066971-input-menu": checkInputMenu,
  "report-1795067325-input-config": checkInputConfig,
  "report-1795071219-input-query": checkInputQuery,
  "report-1795071321-input-adjacent": checkInputAdjacent,
  "report-1795073129-input-dependencies": checkInputSqlLiteral,
  "report-published-app-search": checkPublishedAppSearch,
  "report-project-list-columns": checkProjectListColumns,
  "report-1794899298.142179-library": checkLibrary,
  "markdown-text-cells": checkMarkdownTextCells,
  "browse-data-catalog": async (page, base) => {
    for (const [phase, check] of [
      ["catalog", checkBrowseDataCatalog],
      ["notebook-preview", checkNotebookTablePreview],
    ] as const) {
      try {
        await check(page, base);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const waiting = error.message.match(/waiting for ([^\n]+)/)?.[1];
        const target = waiting?.slice(0, 220);
        const detail = error.message.split("\n", 1)[0];
        const diagnostic = new Error(
          `phase=${phase} target=${target ?? "unknown"}: ${detail}`,
          { cause: error },
        );
        diagnostic.name = error.name;
        throw diagnostic;
      }
    }
  },
  "download-csv": checkDownloadCsv,
  "parameter-query": checkParameterQuery,
  "cell-reorder": checkCellReorder,
  "chained-sql-cell": checkChainedSqlCell,
  "cell-delete-immediate": checkCellDeleteImmediate,
  "saved-result-paging": checkSavedResultPaging,
  "notebook-keyboard-shortcuts": checkNotebookKeyboardShortcuts,
  "publish-dashboard": checkPublishDashboard,
  "refine-chart": checkRefineChart,
  "chart-formatting": checkChartFormatting,
  "version-history-restore": checkVersionHistoryRestore,
  "qa2-history-save-version-keyboard": checkHistorySaveVersionKeyboard,
  "qa2-publish-dialog-open-state": checkPublishDialogOpenState,
  "qa2-share-panel-staged-invites": sharePanelStagesInvitesWithoutSending,
  "organize-collection-dialog": checkCollectionDialog,
  "result-preview": checkSayaSqlBasic,
  "sql-connected-source-ui": checkSqlConnectedSourceUi,
};
const unavailable: Partial<Record<SupplementalFlowName, string>> = {
  "organize-and-share":
    "Collection membership and authorized recipient fixtures are required for the complete flow",
  "demo-dispatch-chart":
    "Dispatch chart fixture is not wired into this collector",
  "demo-mcp-chart":
    "Authenticated MCP fixture is not wired into this collector",
  "report-search-filters":
    "This controlled search scenario needs its isolated local fixture",
  "first-run-setup": "A fresh isolated new-admin fixture is required",
  "report-M5-T2-F-04-settings-search":
    "The isolated local settings fixture is required",
  "report-M5-T2-F-01-keyboard-shortcuts":
    "The isolated local shortcuts fixture is required",
  "report-455-456-editor-preferences":
    "The isolated local preferences fixture is required",
  "report-1794899960.825799-home-app-intent":
    "The isolated local app-intent fixture is required",
  "report-1794899542.541439-notifications":
    "The isolated local notifications fixture is required",
  "app-intent-transport":
    "The controlled local chat transport fixture is required",
  "report-pager-empty-continuation":
    "The controlled local pagination fixture is required",
  "report-1794900229.518749-home-create-collection":
    "The isolated local collection fixture is required",
  "report-F12-query-error-reload":
    "The isolated local missing-connection fixture is required",
  "query-cancellation-transport":
    "The controlled local cancellation fixture is required",
  "steve-demo-monthly-revenue": "The isolated demo SQL fixture is required",
  "DATA-FAVORITES": "The focused daily warehouse fixture is required",
  "python-cell-run":
    "Stored unsupported code and hidden creation controls are not verified together",
  "billing-analysis-end-to-end":
    "Warehouse, agent and second-user fixtures are required",
};

export async function runSupplementalFlow(
  name: SupplementalFlowName,
  page: Page,
  base: string,
  options: {
    warehouseTableQuery?: string;
    warehouseFixtureConnectionId?: string;
    expectedWarehouseRows?: unknown[][];
    fakeProviderUrl?: string;
    selectLiveModel?: boolean;
  } = {},
): Promise<SupplementalResult> {
  if (name === "sql-editor-affordances") {
    // guard:allow-env-credential — isolated local test database, validated by the helper
    const databaseUrl = process.env.ANALYTICS_SQL_REVIEW_DATABASE_URL;
    if (!databaseUrl)
      return {
        status: "unavailable",
        reason: "The isolated local SQL review database is unavailable",
      };
    await mkdir(".tmp/analytics-owner", { recursive: true });
    await checkSayaSqlBasic(page, base);
    console.log("SQL_REVIEW_STAGE basic complete");
    await checkSqlAgentReview(page, base, databaseUrl);
    return { status: "pass" };
  }
  if (name === "query-error-cancel") {
    if (!options.fakeProviderUrl)
      return {
        status: "unavailable",
        reason: "The isolated pending BigQuery provider fixture is required",
      };
    await checkQueryErrorCancel(page, base, options.fakeProviderUrl);
    return { status: "pass" };
  }
  if (name === "default-connection-new-cell") {
    const result = await checkDefaultConnection(
      page,
      base,
      options.warehouseTableQuery,
      options.expectedWarehouseRows,
      options.selectLiveModel,
      options.warehouseFixtureConnectionId,
    );
    return result;
  }
  if (options.selectLiveModel) {
    const liveRun = (
      liveFixtureFlows as Partial<
        Record<string, (page: Page, base: string) => Promise<void>>
      >
    )[name];
    if (liveRun) {
      try {
        await liveRun(page, base);
      } catch (error) {
        if (error instanceof LiveFixtureUnavailable)
          return { status: "unavailable", reason: error.message };
        throw error;
      }
      return { status: "pass" };
    }
    const gap = liveFixtureGaps[name];
    if (gap && !implemented[name])
      return { status: "unavailable", reason: gap };
  }
  const run = implemented[name];
  if (run) {
    await run(page, base);
    return { status: "pass" };
  }
  const reason = unavailable[name];
  if (!reason) throw new Error(`Unregistered supplemental flow: ${name}`);
  return { status: "unavailable", reason };
}
