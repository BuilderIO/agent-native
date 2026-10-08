import { describe, expect, it } from "vitest";

import { nextAutosaveRetryDelayMs } from "./plan-autosave-retry";

describe("nextAutosaveRetryDelayMs", () => {
  it("backs off from one second to the cap", () => {
    expect(nextAutosaveRetryDelayMs(1, false)).toBe(1_000);
    expect(nextAutosaveRetryDelayMs(2, false)).toBe(2_000);
    expect(nextAutosaveRetryDelayMs(5, false)).toBe(16_000);
    expect(nextAutosaveRetryDelayMs(6, false)).toBe(30_000);
  });

  it("keeps retrying after a long outage instead of leaving the edit unsaved", () => {
    expect(nextAutosaveRetryDelayMs(40, false)).toBe(30_000);
  });

  it("leaves an overlap with someone else's edit to the person", () => {
    expect(nextAutosaveRetryDelayMs(1, true)).toBeNull();
  });
});
