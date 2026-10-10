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
    expect(brainAskThreadIdFromPath(brainAskThreadPath("a b"))).toBe("a b");
    expect(brainAskThreadIdFromPath(brainAskThreadPath(null))).toBeNull();
  });
});
