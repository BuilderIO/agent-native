import { describe, expect, it } from "vitest";

import action from "./provider-api-request.js";

describe("provider-api-request phase-one boundary", () => {
  it("accepts only read-only HubSpot and Salesforce methods", () => {
    for (const provider of ["hubspot", "salesforce"]) {
      for (const method of ["GET", "HEAD"]) {
        expect(
          action.schema.safeParse({
            provider,
            method,
            path: "/objects",
            ...(provider === "salesforce"
              ? { connectionId: "salesforce-connection" }
              : {}),
          }).success,
        ).toBe(true);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(
          action.schema.safeParse({
            provider,
            method,
            path: "/objects",
            ...(provider === "salesforce"
              ? { connectionId: "salesforce-connection" }
              : {}),
          }).success,
        ).toBe(false);
      }
    }
    for (const provider of ["native", "custom"]) {
      expect(
        action.schema.safeParse({
          provider,
          method: "GET",
          path: "/objects",
        }).success,
      ).toBe(false);
    }
  });

  it("requires Salesforce reads to bind token and instance to one granted connection", () => {
    expect(
      action.schema.safeParse({
        provider: "salesforce",
        path: "/services/data/v60.0/query",
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        provider: "salesforce",
        connectionId: "salesforce-connection",
        path: "/services/data/v60.0/query",
      }).success,
    ).toBe(true);
  });

  it("does not expose body cursor pagination in the read-only contract", () => {
    const parsed = action.schema.parse({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
      body: { properties: { dealname: "not forwarded" } },
      pagination: { cursorBodyPath: "after", cursorParam: "after" },
    });

    expect(parsed).not.toHaveProperty("body");
    expect(parsed.pagination).not.toHaveProperty("cursorBodyPath");
  });
});
