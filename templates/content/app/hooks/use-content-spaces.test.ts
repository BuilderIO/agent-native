import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

import {
  shouldAutoEnsureContentSpaces,
  useEnsureContentSpaces,
} from "./use-content-spaces";

describe("shouldAutoEnsureContentSpaces", () => {
  const bootstrapState = {
    querySucceeded: true,
    reconciliationNeeded: true,
    reconciliationKey: "membership-a",
    attemptedReconciliationKey: null,
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
        attemptedReconciliationKey: "membership-a",
      }),
    ).toBe(false);
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        provisioningPending: true,
      }),
    ).toBe(false);
  });

  it("reconciles again when the membership snapshot changes", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        reconciliationKey: "membership-a-and-b",
        attemptedReconciliationKey: "membership-a",
      }),
    ).toBe(true);
  });

  it("retries the same membership snapshot after a failed attempt is cleared", () => {
    expect(
      shouldAutoEnsureContentSpaces({
        ...bootstrapState,
        attemptedReconciliationKey: null,
      }),
    ).toBe(true);
  });
});

describe("useEnsureContentSpaces", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
  });

  it("keeps reconciliation from invalidating every active action query", async () => {
    const refetchQueries = vi.fn().mockResolvedValue(undefined);
    useQueryClient.mockReturnValue({ refetchQueries });
    useActionMutation.mockImplementation((_name, options) => options);

    useEnsureContentSpaces();

    const options = useActionMutation.mock.calls[0]?.[1];
    expect(options).toEqual(
      expect.objectContaining({
        skipActionQueryInvalidation: true,
      }),
    );
    await options.onSuccess();
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-content-spaces"],
    });
  });
});
