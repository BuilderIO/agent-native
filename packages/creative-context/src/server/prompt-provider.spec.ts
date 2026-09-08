import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getBrandProfile: vi.fn(),
  provider: null as null | {
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

import {
  publishedBrandContextInput,
  registerCreativeContextPromptProvider,
} from "./prompt-provider.js";

describe("creative context prompt provider", () => {
  beforeEach(() => {
    mocks.readAppState.mockReset();
    mocks.getBrandProfile.mockReset();
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
});
