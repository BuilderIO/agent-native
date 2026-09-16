import { describe, expect, it } from "vitest";

import { loader } from "./apps[.]json";

describe("apps marketplace feed", () => {
  it("publishes first-party and community entries with cross-origin caching", async () => {
    const response = await loader();
    const body = (await response.json()) as {
      version: number;
      apps: Array<{ source: string; capabilities: string[] }>;
    };
    expect(body.version).toBe(1);
    expect(body.apps.some((app) => app.source === "first-party")).toBe(true);
    expect(body.apps.some((app) => app.source === "community")).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
