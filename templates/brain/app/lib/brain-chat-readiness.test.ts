import { describe, expect, it } from "vitest";

import { shouldEnableBrainProviderStatusChecks } from "./brain-chat-readiness.js";

describe("shouldEnableBrainProviderStatusChecks", () => {
  it("keeps provider probes enabled without a connected managed gateway", () => {
    expect(shouldEnableBrainProviderStatusChecks(false, false)).toBe(true);
  });

  it("bypasses provider probes for a fresh connected Builder status", () => {
    expect(shouldEnableBrainProviderStatusChecks(true, false)).toBe(false);
  });

  it("keeps provider probes enabled when connected Builder status is stale", () => {
    expect(shouldEnableBrainProviderStatusChecks(true, true)).toBe(true);
  });
});
