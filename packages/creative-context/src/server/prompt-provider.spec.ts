import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getBrandProfile: vi.fn(),
  isCreativeContextLabAvailable: vi.fn(),
  getCreativeContext: vi.fn(),
  provider: null as null | {
    failOnError?: boolean;
    load: (context: {
      owner: string;
      compact: boolean;
      orgId: string | null;
    }) => Promise<unknown> | unknown;
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  registerPromptContextProvider: vi.fn((provider) => {
    mocks.provider = provider;
    return () => {
      mocks.provider = null;
    };
  }),
}));

vi.mock("../store/brand.js", () => ({
  getBrandProfile: mocks.getBrandProfile,
}));

vi.mock("./labs.js", () => ({
  isCreativeContextLabAvailable: mocks.isCreativeContextLabAvailable,
}));

vi.mock("./context.js", () => ({
  getCreativeContext: mocks.getCreativeContext,
}));

import {
  publishedBrandContextInput,
  registerCreativeContextPromptProvider,
} from "./prompt-provider.js";

describe("creative context prompt provider", () => {
  beforeEach(() => {
    mocks.readAppState.mockReset();
    mocks.getBrandProfile.mockReset();
    mocks.isCreativeContextLabAvailable.mockReset();
    mocks.getCreativeContext.mockReturnValue({
      labKey: "creative-context.library",
    });
    mocks.isCreativeContextLabAvailable.mockResolvedValue(true);
  });

  it("maps only structured published payload fields into the compiler", () => {
    expect(
      publishedBrandContextInput("brand", "dna", {
        summary: "untrusted free-form summary",
        visual: {
          colors: [{ role: "accent", value: "#5B4FE9" }],
          fonts: [{ family: "Inter" }],
        },
        voice: { descriptors: ["direct"] },
      }),
    ).toEqual({
      profileId: "brand",
      dnaVersionId: "dna",
      colors: [{ role: "accent", value: "#5B4FE9" }],
      fonts: [{ family: "Inter" }],
      numericScales: undefined,
      voiceDescriptors: ["direct"],
      layoutPatterns: undefined,
      logos: undefined,
      terminology: undefined,
      exclusions: undefined,
      inventory: undefined,
    });
  });

  it("structurally omits published brand context when context mode is off", async () => {
    mocks.readAppState.mockResolvedValue({ contextMode: "off" });
    const unregister = registerCreativeContextPromptProvider();

    await expect(
      mocks.provider?.load({ owner: "user", compact: false, orgId: null }),
    ).resolves.toBeNull();
    expect(mocks.getBrandProfile).not.toHaveBeenCalled();
    unregister();
  });

  it("omits published brand context while its Lab is disabled", async () => {
    mocks.isCreativeContextLabAvailable.mockResolvedValue(false);
    const unregister = registerCreativeContextPromptProvider();

    await expect(
      mocks.provider?.load({
        owner: "user@example.test",
        compact: false,
        orgId: null,
      }),
    ).resolves.toBeNull();
    expect(mocks.isCreativeContextLabAvailable).toHaveBeenCalledWith(
      "user@example.test",
      "creative-context.library",
    );
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.getBrandProfile).not.toHaveBeenCalled();
    unregister();
  });

  it("surfaces an unreadable Lab state instead of loading brand context", async () => {
    mocks.isCreativeContextLabAvailable.mockRejectedValue(
      new Error("settings unavailable"),
    );
    const unregister = registerCreativeContextPromptProvider();
    expect(mocks.provider?.failOnError).toBe(true);

    await expect(
      mocks.provider?.load({
        owner: "user@example.test",
        compact: false,
        orgId: null,
      }),
    ).rejects.toThrow("settings unavailable");
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.getBrandProfile).not.toHaveBeenCalled();
    unregister();
  });
});
