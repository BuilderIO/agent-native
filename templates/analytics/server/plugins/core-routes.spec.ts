import { describe, expect, it } from "vitest";

import { resolveAnalyticsOpenPath } from "./core-routes";

describe("Analytics open links", () => {
  it("opens a session report at its page", () => {
    expect(
      resolveAnalyticsOpenPath({
        view: "session-report",
        params: { reportId: "srep_abc" },
      }),
    ).toBe("/sessions/reports/srep_abc");
  });
});
