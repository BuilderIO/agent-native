import { describe, expect, it } from "vitest";

import { brainAskThreadIdFromPath, brainAskThreadPath } from "./brain";

describe("Brain ask route thread ids", () => {
  it("reads the thread id only from a thread page", () => {
    expect(brainAskThreadIdFromPath("/home")).toBeNull();
    expect(brainAskThreadIdFromPath("/home/")).toBeNull();
    expect(brainAskThreadIdFromPath("/home/thread-1")).toBe("thread-1");
    expect(brainAskThreadIdFromPath("/home/thread-1/")).toBe("thread-1");
    expect(brainAskThreadIdFromPath("/home/a/b")).toBeNull();
  });

  it("round-trips the path it builds", () => {
    expect(brainAskThreadIdFromPath(brainAskThreadPath("thread-1"))).toBe(
      "thread-1",
    );
    expect(brainAskThreadIdFromPath(brainAskThreadPath(null))).toBeNull();
  });

  it("does not throw on a malformed percent escape in a hand-typed link", () => {
    expect(() => brainAskThreadIdFromPath("/home/%")).not.toThrow();
    expect(brainAskThreadIdFromPath("/home/%")).toBe("%");
    expect(brainAskThreadIdFromPath("/home/%E0%A4%A")).toBe("%E0%A4%A");
  });
});
