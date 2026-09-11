import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Analytics dashboard mentions", () => {
  it("loads dashboard summaries instead of every dashboard config", () => {
    const source = readFileSync(
      new URL("./agent-chat.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("listDashboardSummaries");
    expect(source).not.toContain("const { listDashboards }");
  });
});
