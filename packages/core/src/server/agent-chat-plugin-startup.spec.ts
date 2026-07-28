import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agent chat startup", () => {
  it("does not block route readiness on the global stale-run repair", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const startup = source.slice(
      source.indexOf("const initPromise"),
      source.indexOf("const env = process.env.NODE_ENV"),
    );

    expect(startup).not.toContain("reapAllStaleRuns");
  });
});
