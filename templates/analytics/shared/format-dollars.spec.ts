import { formatDollars } from "@agent-native/toolkit/dashboard/format-dollars";
import { describe, expect, it } from "vitest";

describe("formatDollars", () => {
  it("puts the sign before the dollar sign", () => {
    expect(formatDollars(-7505)).toBe("-$7,505");
    expect(formatDollars(111090)).toBe("$111,090");
    expect(formatDollars(0)).toBe("$0");
  });
});
