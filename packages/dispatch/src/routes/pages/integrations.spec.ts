import { describe, expect, it } from "vitest";

import { loader } from "./integrations.js";

describe("legacy integrations route", () => {
  it("returns a relative Settings redirect and preserves the query", () => {
    const response = loader({
      request: new Request(
        "https://dispatch.example.test/integrations?provider=hubspot",
      ),
    } as Parameters<typeof loader>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/settings/integrations?provider=hubspot",
    );
  });
});
