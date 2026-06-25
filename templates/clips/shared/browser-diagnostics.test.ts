import { describe, expect, it } from "vitest";

import {
  parseBrowserDiagnosticsRow,
  redactBrowserDiagnosticString,
  summarizeBrowserDiagnostics,
} from "./browser-diagnostics";

describe("browser diagnostics helpers", () => {
  it("normalizes rows and summarizes console/network failures", () => {
    const diagnostics = parseBrowserDiagnosticsRow({
      pageUrl: "https://clips.example.com/record",
      userAgent: "Test",
      startedAt: "2026-06-22T10:00:00.000Z",
      endedAt: "2026-06-22T10:01:00.000Z",
      consoleLogsJson: JSON.stringify([
        {
          timestampMs: 1,
          elapsedMs: 1,
          level: "warn",
          message: "Slow response",
        },
        {
          timestampMs: 2,
          elapsedMs: 2,
          level: "error",
          message: "Request failed",
        },
      ]),
      networkRequestsJson: JSON.stringify([
        {
          timestampMs: 3,
          elapsedMs: 3,
          type: "fetch",
          method: "GET",
          url: "https://api.example.com/items?token=<redacted>",
          status: 500,
          durationMs: 120,
        },
        {
          timestampMs: 4,
          elapsedMs: 4,
          type: "xhr",
          method: "POST",
          url: "/ok",
          status: 200,
          durationMs: 40,
        },
      ]),
    });

    expect(diagnostics?.summary).toEqual({
      consoleCount: 2,
      consoleErrorCount: 1,
      consoleWarnCount: 1,
      networkCount: 2,
      networkFailureCount: 1,
      capturedAt: "2026-06-22T10:01:00.000Z",
    });
  });

  it("ignores malformed entries instead of throwing", () => {
    const diagnostics = parseBrowserDiagnosticsRow({
      startedAt: "start",
      endedAt: "end",
      consoleLogsJson: JSON.stringify([{ level: "warn" }, null]),
      networkRequestsJson: "not json",
    });

    expect(diagnostics?.consoleLogs).toEqual([]);
    expect(diagnostics?.networkRequests).toEqual([]);
    expect(
      summarizeBrowserDiagnostics({
        consoleLogs: [],
        networkRequests: [],
        endedAt: "end",
      }),
    ).toMatchObject({ consoleCount: 0, networkCount: 0 });
  });

  it("redacts structured and compound credential field names", () => {
    expect(
      redactBrowserDiagnosticString(
        `{"accessToken":"abc","refresh_token":"def","clientSecret":"ghi","apiKey":"jkl","nested":{"sessionId":"mno"},"safe":"visible"}`,
      ),
    ).toBe(
      `{"accessToken":"<redacted>","refresh_token":"<redacted>","clientSecret":"<redacted>","apiKey":"<redacted>","nested":{"sessionId":"<redacted>"},"safe":"visible"}`,
    );
    expect(
      redactBrowserDiagnosticString(
        "Authorization: Bearer abc.def token=plain secret='quoted'",
      ),
    ).toBe("Authorization: <redacted> token=<redacted> secret='<redacted>'");
  });

  it("keeps benign console query values while redacting sensitive keys", () => {
    expect(
      redactBrowserDiagnosticString(
        "Fetch failed /api/issues?ms=12833&frame=15166&view=recording&token=abc123",
      ),
    ).toBe(
      "Fetch failed /api/issues?ms=12833&frame=15166&view=recording&token=<redacted>",
    );
  });

  it("can redact all query values for URL fields", () => {
    expect(
      redactBrowserDiagnosticString(
        "https://api.example.com/items?ms=12833&frame=15166&token=abc123",
        { redactQueryValues: true },
      ),
    ).toBe(
      "https://api.example.com/items?ms=<redacted>&frame=<redacted>&token=<redacted>",
    );
  });
});
