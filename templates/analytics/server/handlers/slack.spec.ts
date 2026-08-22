import { describe, expect, it } from "vitest";

import { parseCursorMap, parseWorkspace } from "./slack";

describe("Slack request parsing", () => {
  it("defaults an omitted workspace to primary but rejects unknown values", () => {
    expect(parseWorkspace()).toBe("primary");
    expect(parseWorkspace("primary")).toBe("primary");
    expect(parseWorkspace("secondary")).toBe("secondary");
    expect(parseWorkspace("bogus")).toBeNull();
  });

  it("accepts only a string cursor map", () => {
    expect(parseCursorMap()).toEqual({ ok: true, value: {} });
    expect(parseCursorMap('{"C1":"1780000000.000000"}')).toEqual({
      ok: true,
      value: { C1: "1780000000.000000" },
    });
    expect(parseCursorMap("{bad")).toEqual({ ok: false });
    expect(parseCursorMap("[]")).toEqual({ ok: false });
    expect(parseCursorMap('{"C1":123}')).toEqual({ ok: false });
  });
});
