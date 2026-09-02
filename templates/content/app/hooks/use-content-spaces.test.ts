import { describe, expect, it } from "vitest";

import { shouldAutoEnsureContentSpaces } from "./use-content-spaces";

describe("shouldAutoEnsureContentSpaces", () => {
  const bootstrapState = {
    querySucceeded: true,
    spaceCount: 0,
    provisioningAttempted: false,
    provisioningPending: false,
  };

  it("provisions after a successful empty space list", () => {
    expect(shouldAutoEnsureContentSpaces(bootstrapState)).toBe(true);
  });

  it("does not reconcile an already populated space list", () => {
    expect(
      shouldAutoEnsureContentSpaces({ ...bootstrapState, spaceCount: 1 }),
    ).toBe(false);
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
