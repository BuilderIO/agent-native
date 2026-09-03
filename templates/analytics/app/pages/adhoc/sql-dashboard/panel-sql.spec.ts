import { describe, expect, it } from "vitest";

import { serializePanelSql } from "./panel-sql";

describe("serializePanelSql", () => {
  it("keeps string SQL unchanged", () => {
    expect(serializePanelSql("SELECT 1")).toBe("SELECT 1");
  });

  it("serializes object descriptors", () => {
    expect(serializePanelSql({ promql: "up", mode: "instant" })).toBe(
      '{"promql":"up","mode":"instant"}',
    );
  });

  it("returns an empty string for invalid SQL shapes", () => {
    expect(serializePanelSql(null)).toBe("");
    expect(serializePanelSql(["up"])).toBe("");
  });
});
