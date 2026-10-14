import { describe, expect, it } from "vitest";

import { providerApiRequestNeedsApproval } from "./index.js";

const needs = (provider: string, method: string, path: string) =>
  providerApiRequestNeedsApproval({ provider, method, path });

describe("providerApiRequestNeedsApproval", () => {
  it("lets reads through", () => {
    expect(needs("stripe", "GET", "/v1/charges")).toBe(false);
    expect(needs("hubspot", "HEAD", "/crm/v3/objects/deals")).toBe(false);
    expect(providerApiRequestNeedsApproval({ provider: "stripe" })).toBe(false);
  });

  it("gates every other method", () => {
    expect(needs("stripe", "POST", "/v1/refunds")).toBe(true);
    expect(needs("hubspot", "PATCH", "/crm/v3/objects/deals/1")).toBe(true);
    expect(needs("jira", "PUT", "/rest/api/3/issue/APP-1")).toBe(true);
    expect(needs("slack", "DELETE", "/chat.delete")).toBe(true);
    expect(needs("slack", "POST", "/chat.postMessage")).toBe(true);
  });

  it("lets listed read-only POST endpoints through", () => {
    expect(needs("hubspot", "POST", "/crm/v3/objects/deals/search")).toBe(
      false,
    );
    expect(needs("gong", "POST", "/calls/extensive")).toBe(false);
    expect(
      needs("gong", "post", "https://api.gong.io/v2/calls/transcript"),
    ).toBe(false);
    expect(needs("notion", "POST", "/databases/abc123/query")).toBe(false);
    expect(needs("ga4", "POST", "/properties/123:runReport")).toBe(false);
    expect(needs("jira", "POST", "/rest/api/3/search/jql/")).toBe(false);
    expect(needs("posthog", "POST", "/api/projects/7/query/?x=1")).toBe(false);
  });

  it("gates POSTs that only resemble a read endpoint", () => {
    expect(needs("hubspot", "POST", "/crm/v3/objects/deals")).toBe(true);
    expect(needs("hubspot", "POST", "/crm/v3/objects/deals/search/extra")).toBe(
      true,
    );
    expect(needs("hubspot", "POST", "/crm/v3/objects/a/b/search")).toBe(true);
    expect(needs("hubspot", "POST", "/crm/v3/objects/../search")).toBe(true);
    expect(needs("hubspot", "POST", "/crm/v3/objects/%2e%2e/search")).toBe(
      true,
    );
    expect(needs("ga4", "POST", "/properties/123:batchDelete")).toBe(true);
    expect(needs("bigquery", "POST", "/projects/p/queries")).toBe(true);
  });

  it("gates writes to custom or unknown providers", () => {
    expect(needs("acme-internal", "POST", "/search")).toBe(true);
    expect(
      providerApiRequestNeedsApproval({ provider: "hubspot", method: "POST" }),
    ).toBe(true);
  });
});
