import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCreativeContextLabEnabled: vi.fn(),
  resolveFromStore: vi.fn(),
}));

vi.mock("./labs.js", () => ({
  assertCreativeContextLabEnabled: mocks.assertCreativeContextLabEnabled,
}));

vi.mock("../store/contexts.js", () => ({
  resolveNativeContextCloneReference: mocks.resolveFromStore,
}));

import { resolveNativeContextCloneReference } from "./native-context-clone.js";

describe("resolveNativeContextCloneReference", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks Labs before reading a clone reference", async () => {
    const input = {
      appId: "design",
      resourceType: "design",
      resourceId: "design-1",
      contextId: "context-1",
      artifactKey: "design:design:design-1",
    };
    const reference = { publishedItemVersionId: "version-1" };
    mocks.resolveFromStore.mockResolvedValue(reference);

    await expect(resolveNativeContextCloneReference(input)).resolves.toBe(
      reference,
    );
    expect(mocks.assertCreativeContextLabEnabled).toHaveBeenCalledOnce();
    expect(mocks.resolveFromStore).toHaveBeenCalledWith(input);
  });

  it("does not read the reference when Labs is disabled or unreadable", async () => {
    mocks.assertCreativeContextLabEnabled.mockRejectedValue(
      new Error("Creative Context is disabled in Labs"),
    );

    await expect(
      resolveNativeContextCloneReference({
        appId: "design",
        resourceType: "design",
        resourceId: "design-1",
        contextId: "context-1",
        artifactKey: "design:design:design-1",
      }),
    ).rejects.toThrow("Creative Context is disabled in Labs");
    expect(mocks.resolveFromStore).not.toHaveBeenCalled();
  });
});
