import { describe, expect, it } from "vitest";

import {
  analyticsAskThreadIdFromPath,
  analyticsAskThreadPath,
  isAnalyticsAskPath,
} from "./ask-route";

describe("analytics ask route paths", () => {
  it("treats the blank page and every thread page as the ask page", () => {
    expect(isAnalyticsAskPath("/ask")).toBe(true);
    expect(isAnalyticsAskPath("/ask/")).toBe(true);
    expect(isAnalyticsAskPath("/ask/thread-1")).toBe(true);
    expect(isAnalyticsAskPath("/asks")).toBe(false);
    expect(isAnalyticsAskPath("/ask-old/thread-1")).toBe(false);
    expect(isAnalyticsAskPath("/dashboards/ask")).toBe(false);
    expect(isAnalyticsAskPath("/")).toBe(false);
  });

  it("reads the thread id only from a thread page", () => {
    expect(analyticsAskThreadIdFromPath("/ask")).toBeNull();
    expect(analyticsAskThreadIdFromPath("/ask/")).toBeNull();
    expect(analyticsAskThreadIdFromPath("/ask/thread-1")).toBe("thread-1");
    expect(analyticsAskThreadIdFromPath("/ask/thread-1/")).toBe("thread-1");
    expect(analyticsAskThreadIdFromPath("/ask/a/b")).toBeNull();
    expect(analyticsAskThreadIdFromPath("/askx/thread-1")).toBeNull();
  });

  it("builds the blank path for null and the thread path otherwise", () => {
    expect(analyticsAskThreadPath(null)).toBe("/ask");
    expect(analyticsAskThreadPath("thread-1")).toBe("/ask/thread-1");
    expect(analyticsAskThreadPath("a b")).toBe("/ask/a%20b");
    expect(
      analyticsAskThreadIdFromPath(analyticsAskThreadPath("thread-1")),
    ).toBe("thread-1");
  });
});
