import { describe, expect, it } from "vitest";

import {
  parseAuditRange,
  startedAfterForAuditRange,
  writeAuditFilterParam,
} from "./audit-filters";

describe("audit filter parsers", () => {
  it("reuses inbox range values", () => {
    expect(parseAuditRange("today")).toBe("today");
    expect(parseAuditRange("7d")).toBe("7d");
    expect(parseAuditRange("month")).toBe("");
  });
});

describe("startedAfterForAuditRange", () => {
  it("returns a stable local-midnight bound", () => {
    expect(startedAfterForAuditRange("")).toBeUndefined();
    const now = new Date();
    expect(startedAfterForAuditRange("today")).toBe(
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    );
  });
});

describe("writeAuditFilterParam", () => {
  it("omits empty filters from the URL", () => {
    expect(
      writeAuditFilterParam(
        new URLSearchParams("factoryId=f1&automation=x&range=today"),
        "automation",
        "",
      ).get("automation"),
    ).toBeNull();
    expect(
      writeAuditFilterParam(
        new URLSearchParams("factoryId=f1"),
        "range",
        "7d",
      ).get("range"),
    ).toBe("7d");
  });
});
