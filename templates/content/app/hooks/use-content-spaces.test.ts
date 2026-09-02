import { describe, expect, it } from "vitest";

import { shouldAutoEnsureContentSpaces } from "./use-content-spaces";

describe("shouldAutoEnsureContentSpaces", () => {
  const bootstrapState = {
    querySucceeded: true,
    reconciliationNeeded: true,
    provisioningAttempted: false,
    provisioningPending: false,
  };

  it("provisions after a successful list reports missing spaces", () => {
    expect(shouldAutoEnsureContentSpaces(bootstrapState)).toBe(true);
  });

  it("does not reconcile a complete membership set", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        reconciliationNeeded: false,
      }),
    ).toBe(false);
  });

  it("reconciles a newly granted organization even with existing spaces", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        reconciliationNeeded: true,
      }),
    ).toBe(true);
  });

  it("waits for a successful list query", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        querySucceeded: false,
      }),
    ).toBe(false);
  });

  it("does not start duplicate provisioning", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        provisioningAttempted: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        provisioningPending: true,
      }),
    ).toBe(false);
  });
});
