import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("authenticated recording route loading", () => {
  it("waits for the browser session before the direct player action", () => {
    const route = readRoute("r.$recordingId.tsx");
    expect(route).toContain("enabled: !!recordingId && !sessionLoading");
    expect(route).toContain("if (sessionLoading || playerDataQ.isLoading)");
  });

  it("waits for the browser session before the share payload request", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain("enabled: !!shareId && !sessionLoading");
    expect(route).toContain("if (sessionLoading || dataQ.isLoading)");
  });
});
