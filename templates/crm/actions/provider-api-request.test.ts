import { describe, expect, it } from "vitest";

import action from "./provider-api-request.js";

describe("provider-api-request phase-one boundary", () => {
  it("accepts only read-only HubSpot methods", () => {
    expect(
      action.schema.safeParse({
        provider: "hubspot",
        method: "GET",
        path: "/crm/v3/objects/deals",
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        provider: "hubspot",
        method: "HEAD",
        path: "/crm/v3/objects/deals",
      }).success,
    ).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        action.schema.safeParse({
          provider: "hubspot",
          method,
          path: "/crm/v3/objects/deals",
        }).success,
      ).toBe(false);
    }
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
