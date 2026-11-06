import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let designData: Record<string, unknown> = {};
  return {
    getDesignData: () => designData,
    setDesignData: (next: Record<string, unknown>) => {
      designData = next;
    },
    mutateDesignData: vi.fn(),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({
    role: "editor",
    resource: { data: JSON.stringify(mocks.getDesignData()) },
  })),
}));

vi.mock("./design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

import { persistScreenFrameType } from "./screen-frame-type-store.js";

describe("persistScreenFrameType", () => {
  beforeEach(() => {
    mocks.mutateDesignData.mockReset();
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (current: Record<string, unknown>) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const next = options.mutate(mocks.getDesignData());
        mocks.setDesignData(next);
        expect(options.isApplied(next)).toBe(true);
      },
    );
  });

  it("backfills a legacy screen that has no stored type", async () => {
    mocks.setDesignData({ screenMetadata: { a: { width: 600 } } });
    await persistScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "hubspot-email",
      onlyIfAbsent: true,
    });
    expect(mocks.getDesignData()).toEqual({
      screenMetadata: { a: { width: 600, frameType: "hubspot-email" } },
    });
  });

  it("writes nothing once a type is stored", async () => {
    mocks.setDesignData({ screenMetadata: { a: { frameType: "web" } } });
    await persistScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "hubspot-email",
      onlyIfAbsent: true,
    });
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
    expect(mocks.getDesignData()).toEqual({
      screenMetadata: { a: { frameType: "web" } },
    });
  });

  it("replaces a stored type on an explicit change", async () => {
    mocks.setDesignData({
      screenMetadata: { a: { frameType: "hubspot-email" } },
    });
    await persistScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "web",
    });
    expect(mocks.getDesignData()).toEqual({
      screenMetadata: { a: { frameType: "web" } },
    });
  });
});
