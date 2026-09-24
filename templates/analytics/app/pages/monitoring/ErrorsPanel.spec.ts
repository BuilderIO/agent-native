import { describe, expect, it } from "vitest";

import { errorStatusFromSearchParams } from "./ErrorsPanel";

describe("Monitoring error filters", () => {
  it("reads shareable status filters and defaults invalid values", () => {
    expect(errorStatusFromSearchParams(new URLSearchParams())).toBe(
      "unresolved",
    );
    expect(
      errorStatusFromSearchParams(new URLSearchParams({ status: "all" })),
    ).toBe("all");
    expect(
      errorStatusFromSearchParams(new URLSearchParams({ status: "ignored" })),
    ).toBe("ignored");
    expect(
      errorStatusFromSearchParams(new URLSearchParams({ status: "unknown" })),
    ).toBe("unresolved");
  });
});
