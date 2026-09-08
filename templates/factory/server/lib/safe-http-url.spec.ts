import { describe, expect, it } from "vitest";

import { safeHttpUrl } from "./safe-http-url";

describe("safeHttpUrl", () => {
  it("rejects javascript and other non-http schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://slack.com/archives/C123/p1")).toBe(
      "https://slack.com/archives/C123/p1",
    );
  });
});
