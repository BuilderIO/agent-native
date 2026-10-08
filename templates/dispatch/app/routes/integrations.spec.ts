import { describe, expect, it } from "vitest";

import { loader } from "./integrations";

describe("legacy integrations route", () => {
  it("redirects into Settings and preserves the mounted path and query", () => {
    const response = loader({
      request: new Request(
        "https://dispatch.example.test/dispatch/integrations?provider=hubspot",
      ),
    } as Parameters<typeof loader>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://dispatch.example.test/dispatch/settings/integrations?provider=hubspot",
    );
  });
});
