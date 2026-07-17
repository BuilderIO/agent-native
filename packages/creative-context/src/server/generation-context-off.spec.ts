import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getContextPack: vi.fn(),
  getCreativeContextItem: vi.fn(),
  listAccessibleSearchDocuments: vi.fn(),
  performCreativeContextSearch: vi.fn(),
  callIsolatedCreativeContextA2A: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("../store/index.js", () => ({
  getContextPack: mocks.getContextPack,
  getCreativeContextItem: mocks.getCreativeContextItem,
  listAccessibleSearchDocuments: mocks.listAccessibleSearchDocuments,
}));

vi.mock("./retrieval.js", () => ({
  performCreativeContextSearch: mocks.performCreativeContextSearch,
}));

vi.mock("./isolated-a2a.js", () => ({
  callIsolatedCreativeContextA2A: mocks.callIsolatedCreativeContextA2A,
  hasIsolatedCreativeContextA2A: vi.fn(() => true),
  isolatedResolvePayload: vi.fn((input) => input),
}));

import {
  resolveGenerationCreativeContext,
  validateGenerationCreativeContext,
} from "./generation-context.js";

describe("creative context structural opt-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAppState.mockResolvedValue({ contextMode: "off" });
  });

  it("rejects an explicit pack before resolving any saved evidence", async () => {
    await expect(
      resolveGenerationCreativeContext({
        role: "slides",
        contextPackId: "pack-1",
      }),
    ).rejects.toThrow(/context is off/i);
    expect(mocks.getContextPack).not.toHaveBeenCalled();
    expect(mocks.performCreativeContextSearch).not.toHaveBeenCalled();
    expect(mocks.callIsolatedCreativeContextA2A).not.toHaveBeenCalled();
  });

  it("rejects an explicit pack before validating final-write provenance", async () => {
    await expect(
      validateGenerationCreativeContext({
        contextPackId: "pack-1",
        reuseLabels: [],
      }),
    ).rejects.toThrow(/context is off/i);
    expect(mocks.getContextPack).not.toHaveBeenCalled();
  });

  it("returns no context and permits only generated labels when off", async () => {
    await expect(
      resolveGenerationCreativeContext({ role: "design", query: "dashboard" }),
    ).resolves.toMatchObject({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [],
      results: [],
    });
    await expect(
      validateGenerationCreativeContext({
        reuseLabels: [
          {
            kind: "screen",
            label: "Net-new screen",
            dataRole: "untrusted-reference",
            elementId: "screen-1",
            influence: "generated",
          },
        ],
      }),
    ).resolves.toMatchObject({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [{ elementId: "screen-1", influence: "generated" }],
    });
  });

  it("applies a one-generation off override without reading or mutating saved preference", async () => {
    mocks.readAppState.mockResolvedValue({
      contextMode: "auto",
      pinnedPackId: "pack-saved",
    });
    await expect(
      resolveGenerationCreativeContext({
        role: "assets",
        query: "campaign",
        contextModeOverride: "off",
      }),
    ).resolves.toEqual({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [],
      results: [],
    });
    await expect(
      validateGenerationCreativeContext({
        contextModeOverride: "off",
        reuseLabels: [
          {
            kind: "image",
            label: "Net-new image",
            dataRole: "untrusted-reference",
            influence: "generated",
          },
        ],
      }),
    ).resolves.toMatchObject({ contextMode: "off", contextPackId: null });
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.getContextPack).not.toHaveBeenCalled();
    expect(mocks.performCreativeContextSearch).not.toHaveBeenCalled();
    expect(mocks.callIsolatedCreativeContextA2A).not.toHaveBeenCalled();
  });

  it("rejects a pack combined with a one-generation off override", async () => {
    await expect(
      resolveGenerationCreativeContext({
        role: "content",
        contextPackId: "pack-1",
        contextModeOverride: "off",
      }),
    ).rejects.toThrow(/off for this generation/i);
    await expect(
      validateGenerationCreativeContext({
        contextPackId: "pack-1",
        contextModeOverride: "off",
      }),
    ).rejects.toThrow(/off for this generation/i);
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });

  it("ignores inherited packs when saved or per-request mode is off", async () => {
    await expect(
      resolveGenerationCreativeContext({
        role: "slides",
        contextPackId: "pack-inherited",
        contextPackSource: "inherited",
      }),
    ).resolves.toMatchObject({ contextMode: "off", contextPackId: null });
    await expect(
      validateGenerationCreativeContext({
        contextPackId: "pack-inherited",
        contextPackSource: "inherited",
        contextModeOverride: "off",
        reuseLabels: [
          {
            kind: "slide",
            label: "Fresh edit",
            dataRole: "untrusted-reference",
            influence: "generated",
          },
        ],
      }),
    ).resolves.toMatchObject({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [{ influence: "generated" }],
    });
    expect(mocks.getContextPack).not.toHaveBeenCalled();
  });

  it("rejects explicit evidence labels and strips inherited evidence when off", async () => {
    const evidence = {
      itemId: "item-1",
      itemVersionId: "version-1",
      kind: "slide",
      label: "Imported slide",
      dataRole: "untrusted-reference" as const,
      influence: "adapted" as const,
    };
    await expect(
      validateGenerationCreativeContext({
        contextModeOverride: "off",
        reuseLabels: [evidence],
        reuseLabelsSource: "explicit",
      }),
    ).rejects.toThrow(/only generated/i);
    await expect(
      validateGenerationCreativeContext({
        contextModeOverride: "off",
        reuseLabels: [
          evidence,
          {
            kind: "slide",
            label: "Fresh slide",
            dataRole: "untrusted-reference",
            influence: "generated",
          },
        ],
        reuseLabelsSource: "inherited",
      }),
    ).resolves.toMatchObject({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [{ label: "Fresh slide", influence: "generated" }],
    });
    expect(mocks.getContextPack).not.toHaveBeenCalled();
  });
});
