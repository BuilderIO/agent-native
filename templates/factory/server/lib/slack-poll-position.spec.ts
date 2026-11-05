import { describe, expect, it } from "vitest";

import {
  decodeSlackPosition,
  decodeSlackResume,
  encodeSlackPosition,
  encodeSlackResume,
  laterSlackTs,
} from "./slack-poll-position.js";

describe("a Slack read's saved position", () => {
  it("is the bare message time when the read finished", () => {
    expect(encodeSlackPosition({ ts: "100.000100" })).toBe("100.000100");
    expect(decodeSlackPosition("100.000100")).toEqual({ ts: "100.000100" });
  });

  it("carries where the older messages continue, and gives it back unchanged", () => {
    const resume = encodeSlackResume({
      newest: "700.000100",
      cursor: "bmV4dA==",
    });
    const saved = encodeSlackPosition({ ts: "100.000100", resume });

    expect(saved).toBe("100.000100|700.000100|bmV4dA==");
    expect(decodeSlackPosition(saved)).toEqual({ ts: "100.000100", resume });
    expect(decodeSlackResume(resume)).toEqual({
      newest: "700.000100",
      cursor: "bmV4dA==",
    });
  });

  it("reads a plain Slack cursor, which every row stored before this holds, as a cursor with no newest time", () => {
    expect(decodeSlackResume("bmV4dA==")).toEqual({ cursor: "bmV4dA==" });
  });

  it("refuses a position the source cannot save, rather than saving a cut one", () => {
    expect(() =>
      encodeSlackPosition({ ts: "1.0", resume: "x".repeat(250) }),
    ).toThrow(/cannot go on from where this read stopped/);
  });

  it("compares message times as numbers", () => {
    expect(laterSlackTs("99.000100", "100.000100")).toBe("100.000100");
    expect(laterSlackTs("200.5", "100.000100")).toBe("200.5");
  });
});
