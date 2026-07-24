import {
  DASHBOARD_REPORT_READY_TIMEOUT_MS,
  FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS,
} from "@shared/dashboard-report-timeouts";
import { describe, expect, it } from "vitest";

import {
  DASHBOARD_REPORT_BOOTSTRAP_RETRY_DELAY_MS,
  DASHBOARD_REPORT_BOOTSTRAP_TIMEOUT_MS,
  dashboardReportCaptureError,
  hasDashboardReportEmbedToken,
  isDashboardReportScreenshot,
} from "./dashboard-report-capture";

describe("dashboard report capture bootstrap", () => {
  it("only bypasses the client session gate for a token-bearing report URL", () => {
    expect(isDashboardReportScreenshot("?reportScreenshot=1")).toBe(true);
    expect(
      hasDashboardReportEmbedToken(
        "?reportScreenshot=1&__an_embed_token=signed-token",
      ),
    ).toBe(true);
    expect(hasDashboardReportEmbedToken("?reportScreenshot=1")).toBe(false);
    expect(
      hasDashboardReportEmbedToken("?reportScreenshot=1", "stored-token"),
    ).toBe(true);
    expect(hasDashboardReportEmbedToken("?reportScreenshot=1&embedded=1")).toBe(
      false,
    );
    expect(hasDashboardReportEmbedToken("?__an_embed_token=signed-token")).toBe(
      false,
    );
  });

  it("keeps bootstrap retries within the report-ready budget", () => {
    expect(
      DASHBOARD_REPORT_BOOTSTRAP_TIMEOUT_MS * 2 +
        DASHBOARD_REPORT_BOOTSTRAP_RETRY_DELAY_MS +
        FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS,
    ).toBeLessThan(DASHBOARD_REPORT_READY_TIMEOUT_MS);
    expect(DASHBOARD_REPORT_BOOTSTRAP_RETRY_DELAY_MS).toBeLessThan(1_000);
  });

  it("bounds and redacts capture diagnostics", () => {
    expect(
      dashboardReportCaptureError(
        new Error(
          "request failed at ?__an_embed_token=secret-token&reportScreenshot=1",
        ),
      ),
    ).toContain("__an_embed_token=[REDACTED]");
  });
});
