import { describe, expect, it } from "vitest";
import {
  hasDataQueryAttempt,
  isSafeNoDataAnalyticsResponse,
  looksLikeAnalyticsDataRequest,
  stripInjectedAnalyticsGuardContext,
} from "./real-data-actions";

describe("real data action classification", () => {
  it("treats unstructured source records as real analytics evidence", () => {
    expect(hasDataQueryAttempt([{ name: "gong-calls" }])).toBe(true);
    expect(hasDataQueryAttempt([{ name: "slack-messages" }])).toBe(true);
  });

  it("treats broad HubSpot record lookups as real CRM evidence", () => {
    expect(hasDataQueryAttempt([{ name: "hubspot-records" }])).toBe(true);
  });

  it("treats connected MCP provider tools as real source evidence", () => {
    expect(
      hasDataQueryAttempt([
        { name: "mcp__codex_apps__hubspot__legacy.__search" },
      ]),
    ).toBe(true);
  });

  it("does not count setup or artifact-only actions as source evidence", () => {
    expect(hasDataQueryAttempt([{ name: "data-source-status" }])).toBe(false);
    expect(hasDataQueryAttempt([{ name: "save-analysis" }])).toBe(false);
    expect(hasDataQueryAttempt([{ name: "generate-chart" }])).toBe(false);
  });
});

describe("analytics data request classification", () => {
  it("ignores framework-injected screen context when classifying the user ask", () => {
    const text =
      "i want a recurring job this is the .yml file\n\n" +
      "<current-screen>\n" +
      "Onboarding Progress\nCustomers in onboarding status\nMetrics dashboard\n" +
      "</current-screen>";

    expect(stripInjectedAnalyticsGuardContext(text)).toBe(
      "i want a recurring job this is the .yml file",
    );
    expect(looksLikeAnalyticsDataRequest(text)).toBe(false);
  });

  it("does not treat GitHub Actions workflow migrations as analytics requests", () => {
    const text =
      '<attachment name="workflow.yml">\n' +
      "on:\n  schedule:\n    - cron: '0 12 * * *'\n" +
      "jobs:\n  post-message:\n    steps:\n      - run: pnpm script\n" +
      "</attachment>\n\n" +
      "I have a GitHub action from a previous repo and wanted to create a recurring job based on this .yml file.";

    expect(looksLikeAnalyticsDataRequest(text)).toBe(false);
  });

  it("still recognizes real analytics questions after stripping context", () => {
    const text =
      "How many signups came from paid traffic last week?\n\n" +
      "<current-screen>\nSettings page\n</current-screen>";

    expect(looksLikeAnalyticsDataRequest(text)).toBe(true);
  });

  it("respects explicit real-data markers", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "REAL_DATA_REQUIRED: analyze Slack messages for onboarding objections",
      ),
    ).toBe(true);
  });

  it("keeps non-data app maintenance requests out of the guard", () => {
    expect(looksLikeAnalyticsDataRequest("fix the dashboard layout")).toBe(
      false,
    );
  });

  it("does not classify generic chat/message bug reports as data requests", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "the chat keeps typing long messages that disappear",
      ),
    ).toBe(false);
  });
});

describe("safe no-data analytics responses", () => {
  it("allows explicit unavailable-source answers without forcing another retry", () => {
    expect(
      isSafeNoDataAnalyticsResponse(
        "I can't retrieve this data right now because BigQuery credentials are not configured.",
      ),
    ).toBe(true);
  });

  it("allows clarification questions without unsupported result claims", () => {
    expect(
      isSafeNoDataAnalyticsResponse(
        "Which data source should I use for signups: GA4 or BigQuery?",
      ),
    ).toBe(true);
  });

  it("blocks unsupported metric claims", () => {
    expect(
      isSafeNoDataAnalyticsResponse("The data shows 42 signups last week."),
    ).toBe(false);
  });
});
