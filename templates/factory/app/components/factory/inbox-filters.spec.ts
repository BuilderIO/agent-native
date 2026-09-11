import { describe, expect, it } from "vitest";

import {
  parseInboxRange,
  parseInboxRisk,
  parseInboxSource,
  parseInboxStatus,
  updatedAfterForRange,
  writeInboxFilterParam,
} from "./inbox-filters";

describe("inbox filter parsers", () => {
  it("accepts known values and rejects unknown ones", () => {
    expect(parseInboxStatus("failed")).toBe("failed");
    expect(parseInboxStatus("nope")).toBe("");
    expect(parseInboxRisk("high")).toBe("high");
    expect(parseInboxRisk("urgent")).toBe("");
    expect(parseInboxSource("slack")).toBe("slack");
    expect(parseInboxSource("email")).toBe("");
    expect(parseInboxRange("7d")).toBe("7d");
    expect(parseInboxRange("month")).toBe("");
  });
});

describe("updatedAfterForRange", () => {
  it("returns a stable local-midnight bound for today and 7 days", () => {
    expect(updatedAfterForRange("")).toBeUndefined();
    const now = new Date();
    expect(updatedAfterForRange("today")).toBe(
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    );
    expect(updatedAfterForRange("7d")).toBe(
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 7,
      ).toISOString(),
    );
    expect(updatedAfterForRange("7d")).toBe(updatedAfterForRange("7d"));
  });
});

describe("writeInboxFilterParam", () => {
  it("omits default empty filters from the URL", () => {
    const params = writeInboxFilterParam(
      new URLSearchParams("factoryId=f1&status=failed"),
      "status",
      "",
    );
    expect(params.get("status")).toBeNull();
    expect(params.get("factoryId")).toBe("f1");
    expect(
      writeInboxFilterParam(
        new URLSearchParams("factoryId=f1"),
        "risk",
        "high",
      ).get("risk"),
    ).toBe("high");
  });
});
