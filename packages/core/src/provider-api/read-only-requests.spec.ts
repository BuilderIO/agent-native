import { describe, expect, it } from "vitest";

import { isReadOnlyProviderPost } from "./read-only-requests.js";

const post = (provider: string, path: string, body?: unknown) => ({
  provider,
  method: "POST",
  path,
  ...(body === undefined ? {} : { body }),
});

describe("isReadOnlyProviderPost", () => {
  it.each([
    ["ga4", "/properties/{propertyId}:runReport"],
    ["ga4", "/v1beta/properties/123456:batchRunReports"],
    ["ga4", "/properties/123456:runRealtimeReport"],
    ["ga4", "/properties/123456:runPivotReport?alt=json"],
    [
      "ga4",
      "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport",
    ],
    [
      "ga4",
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    ],
    [
      "gcloud",
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query",
    ],
    ["hubspot", "/crm/v3/objects/contacts/search"],
    ["hubspot", "/crm/v3/objects/deals/batch/read"],
    ["hubspot", "/crm/v4/associations/contacts/companies/batch/read"],
    ["hubspot", "https://api.hubapi.com/crm/v3/objects/companies/search"],
    ["gong", "/calls/extensive"],
    ["gong", "/v2/calls/transcript"],
    ["notion", "/databases/abc/query"],
    ["posthog", "/api/projects/{projectId}/query/"],
    ["jira", "/rest/api/3/search/jql"],
    ["prometheus", "/api/v1/query_range"],
  ])("treats %s POST %s as a read", (provider, path) => {
    expect(isReadOnlyProviderPost(post(provider, path))).toBe(true);
  });

  it.each([
    ["ga4", "/properties/123:audienceExports"],
    ["ga4", "/properties/123:runReport/extra"],
    ["hubspot", "/crm/v3/objects/contacts"],
    ["hubspot", "/crm/v3/objects/contacts/batch/create"],
    ["hubspot", "/crm/v3/objects/contacts/batch/update"],
    ["gong", "/calls"],
    ["notion", "/pages"],
    ["slack", "/chat.postMessage"],
    ["my-custom-api", "/crm/v3/objects/contacts/search"],
    // A listed path on a host the rule does not own is not that endpoint.
    ["hubspot", "https://evil.example.com/crm/v3/objects/contacts/search"],
    ["prometheus", "https://prometheus.example.com/api/v1/query"],
  ])("keeps %s POST %s a write", (provider, path) => {
    expect(isReadOnlyProviderPost(post(provider, path))).toBe(false);
  });

  it("only counts BigQuery queries that are dry runs", () => {
    const queries = "/projects/{projectId}/queries";
    expect(
      isReadOnlyProviderPost(
        post("bigquery", queries, { query: "SELECT 1", dryRun: true }),
      ),
    ).toBe(true);
    expect(
      isReadOnlyProviderPost(
        post("bigquery", queries, JSON.stringify({ dryRun: true })),
      ),
    ).toBe(true);
    expect(
      isReadOnlyProviderPost(
        post("bigquery", "/projects/p/jobs", {
          configuration: { dryRun: true, query: { query: "SELECT 1" } },
        }),
      ),
    ).toBe(true);
    expect(
      isReadOnlyProviderPost(post("bigquery", queries, { query: "SELECT 1" })),
    ).toBe(false);
    expect(
      isReadOnlyProviderPost(
        post("bigquery", queries, { query: "DELETE FROM t", dryRun: "true" }),
      ),
    ).toBe(false);
    expect(isReadOnlyProviderPost(post("bigquery", queries, "not json"))).toBe(
      false,
    );
  });

  it("never treats another method as a read-only POST", () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(
        isReadOnlyProviderPost({
          provider: "hubspot",
          method,
          path: "/crm/v3/objects/contacts/search",
        }),
      ).toBe(false);
    }
  });
});
