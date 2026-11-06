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

import { createHubSpotEmailHtml } from "../../shared/hubspot-email.js";
import {
  changeScreenFrameType,
  persistScreenFrameType,
} from "./screen-frame-type-store.js";

const applyMutation = () => {
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
};

describe("persistScreenFrameType", () => {
  beforeEach(applyMutation);

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

describe("changeScreenFrameType", () => {
  beforeEach(applyMutation);

  it("lays out a web screen as an email when it becomes one", async () => {
    mocks.setDesignData({
      canvasFrames: { a: { x: 10, y: 20, width: 1440, height: 900 } },
      screenMetadata: {
        a: { width: 1440, height: 900, breakpointWidths: [390, 768] },
      },
    });
    await changeScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "hubspot-email",
      content: "<main>Promo</main>",
    });
    expect(mocks.getDesignData()).toEqual({
      canvasFrames: { a: { x: 10, y: 20, width: 600, height: 900 } },
      screenMetadata: {
        a: {
          width: 600,
          height: 900,
          breakpointWidths: [],
          heightMode: "hug",
          heightPinned: false,
          frameType: "hubspot-email",
        },
      },
    });
  });

  it("gives an email switched back to web the design's breakpoints again", async () => {
    mocks.setDesignData({
      canvasFrames: { a: { x: 0, y: 0, width: 600, height: 800 } },
      screenMetadata: {
        a: { width: 600, breakpointWidths: [], frameType: "hubspot-email" },
      },
    });
    await changeScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "web",
      content: "<main>Promo</main>",
    });
    expect(mocks.getDesignData()).toEqual({
      canvasFrames: { a: { x: 0, y: 0, width: 600, height: 800 } },
      screenMetadata: { a: { width: 600, frameType: "web" } },
    });
  });

  it("keeps a fixed screen's empty breakpoints when it was never an email", async () => {
    mocks.setDesignData({
      screenMetadata: { a: { width: 1080, breakpointWidths: [] } },
    });
    await changeScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "web",
      content: "<main>Poster</main>",
    });
    expect(mocks.getDesignData()).toEqual({
      screenMetadata: {
        a: { width: 1080, breakpointWidths: [], frameType: "web" },
      },
    });
  });

  it("only records the type of a legacy email confirmed as an email", async () => {
    mocks.setDesignData({
      screenMetadata: { a: { width: 600, height: 1200, heightMode: "fixed" } },
    });
    await changeScreenFrameType({
      designId: "design",
      fileId: "a",
      frameType: "hubspot-email",
      content: createHubSpotEmailHtml(),
    });
    expect(mocks.getDesignData()).toEqual({
      screenMetadata: {
        a: {
          width: 600,
          height: 1200,
          heightMode: "fixed",
          frameType: "hubspot-email",
        },
      },
    });
  });
});
