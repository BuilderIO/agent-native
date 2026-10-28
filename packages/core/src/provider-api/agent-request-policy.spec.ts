import { describe, expect, it } from "vitest";

import {
  assertAgentProviderRequestAllowed,
  providerApiAgentRequestsReadOnly,
} from "./agent-request-policy.js";

describe("providerApiAgentRequestsReadOnly", () => {
  it("limits HubSpot agent requests to reads", () => {
    expect(providerApiAgentRequestsReadOnly("hubspot")).toBe(true);
  });

  it.each(["slack", "gong", "my-custom-api", ""])(
    "leaves %j writable",
    (provider) => {
      expect(providerApiAgentRequestsReadOnly(provider)).toBe(false);
    },
  );
});

describe("assertAgentProviderRequestAllowed", () => {
  it.each([
    { method: "GET", path: "/crm/v3/objects/deals" },
    { method: "get", path: "/crm/v3/objects/deals" },
    { method: "HEAD", path: "/crm/v3/objects/deals" },
    { method: undefined, path: "/crm/v3/objects/deals" },
    { method: null, path: "/crm/v3/objects/deals" },
    { method: "POST", path: "/crm/v3/objects/contacts/search" },
  ])("allows a HubSpot read: %j", (request) => {
    expect(() =>
      assertAgentProviderRequestAllowed({ provider: "hubspot", ...request }),
    ).not.toThrow();
  });

  it.each([
    { method: "POST", path: "/crm/v3/objects/contacts" },
    { method: "post", path: "/crm/v3/objects/contacts/batch/update" },
    { method: "PATCH", path: "/crm/v3/objects/deals/1" },
    { method: "PUT", path: "/crm/v3/objects/deals/1" },
    { method: "DELETE", path: "/crm/v3/objects/contacts/1" },
  ])("refuses a HubSpot write: %j", (request) => {
    let error: unknown;
    try {
      assertAgentProviderRequestAllowed({ provider: "hubspot", ...request });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      errorCode: "provider_writes_not_allowed",
      statusCode: 403,
      message:
        "hubspot requests from agent tools are read-only. Make the change with the provider's MCP tools or an app action built for it.",
    });
  });

  it.each(["POST", "PATCH", "DELETE"])(
    "allows a %s to a provider that is not read-only",
    (method) => {
      expect(() =>
        assertAgentProviderRequestAllowed({
          provider: "slack",
          method,
          path: "/chat.postMessage",
        }),
      ).not.toThrow();
    },
  );
});
