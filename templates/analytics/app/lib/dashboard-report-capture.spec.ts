import { describe, expect, it } from "vitest";

import {
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
