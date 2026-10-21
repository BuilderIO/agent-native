import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  blobConfigured: false,
  hosted: false,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/private-blob", () => ({
  isPrivateBlobConfiguredForRequest: async () => state.blobConfigured,
}));

vi.mock("../server/lib/uploaded-reference-storage.js", () => ({
  isHostedSlidesRuntime: () => state.hosted,
}));

import action from "./get-slides-2-upload-storage-status";

const run = action.run as () => Promise<{ referenceStorageReady: boolean }>;

describe("get-slides-2-upload-storage-status", () => {
  beforeEach(() => {
    state.blobConfigured = false;
    state.hosted = false;
  });

  it("is an authenticated, read-only UI action", () => {
    expect(action).toMatchObject({
      http: { method: "GET" },
      readOnly: true,
      requiresAuth: true,
      agentTool: false,
    });
  });

  it("keeps local reference storage available", async () => {
    await expect(run()).resolves.toEqual({ referenceStorageReady: true });
  });

  it("reports hosted storage readiness for the current request", async () => {
    state.hosted = true;
    state.blobConfigured = true;
    await expect(run()).resolves.toEqual({ referenceStorageReady: true });

    state.blobConfigured = false;
    await expect(run()).resolves.toEqual({ referenceStorageReady: false });
  });
});
