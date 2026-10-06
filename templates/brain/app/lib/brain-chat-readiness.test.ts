import { describe, expect, it } from "vitest";

import { shouldEnableBrainProviderStatusChecks } from "./brain-chat-readiness.js";

describe("shouldEnableBrainProviderStatusChecks", () => {
  it("keeps the strict shared chat eligibility check enabled", () => {
    expect(shouldEnableBrainProviderStatusChecks()).toBe(true);
  });
});
