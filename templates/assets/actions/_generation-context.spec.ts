import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const getRequestRunContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: getRequestRunContextMock,
}));

import { readGenerationContextDefaults } from "./_generation-context.js";

describe("readGenerationContextDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestRunContextMock.mockReturnValue(undefined);
    readAppStateMock.mockResolvedValue(null);
  });

  it("reads brand kit and preset from the browser-tab-scoped context first", async () => {
    getRequestRunContextMock.mockReturnValue({ browserTabId: "tab-1" });
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "generation-context") {
        return {
          libraryId: "global-lib",
          presetId: "global-preset",
          model: "gemini-3.1-flash-image",
          aspectRatio: "1:1",
          imageSize: "2K",
          count: 4,
          mediaType: "image",
        };
      }
      if (key === "generation-context:tab-1") {
        return {
          libraryId: "tab-lib",
          presetId: "tab-preset",
        };
      }
      return null;
    });

    await expect(readGenerationContextDefaults()).resolves.toMatchObject({
      libraryId: "tab-lib",
      presetId: "tab-preset",
      model: "gemini-3.1-flash-image",
      aspectRatio: "1:1",
      imageSize: "2K",
      count: 4,
      mediaType: "image",
    });
  });

  it("reads video defaults from the global context", async () => {
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "generation-context") {
        return {
          libraryId: "video-lib",
          presetId: "video-preset",
          mediaType: "video",
          model: "veo-3.1-fast-generate-preview",
          aspectRatio: "9:16",
          videoDurationSeconds: 6,
          videoResolution: "1080p",
        };
      }
      return null;
    });

    await expect(readGenerationContextDefaults()).resolves.toMatchObject({
      libraryId: "video-lib",
      presetId: "video-preset",
      mediaType: "video",
      model: "veo-3.1-fast-generate-preview",
      aspectRatio: "9:16",
      videoDurationSeconds: 6,
      videoResolution: "1080p",
    });
  });

  it("falls back to the global context when there is no scoped context", async () => {
    getRequestRunContextMock.mockReturnValue({ browserTabId: "tab-2" });
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "generation-context") {
        return {
          libraryId: "global-lib",
          presetId: "global-preset",
          aspectRatio: "16:9",
          imageSize: "1K",
        };
      }
      return null;
    });

    await expect(readGenerationContextDefaults()).resolves.toMatchObject({
      libraryId: "global-lib",
      presetId: "global-preset",
      aspectRatio: "16:9",
      imageSize: "1K",
    });
  });

  it("uses the legacy model when the generation context has no model", async () => {
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key === "imageGenerationModel") {
        return { model: "gemini-3-pro-image" };
      }
      return null;
    });

    await expect(readGenerationContextDefaults()).resolves.toMatchObject({
      model: "gemini-3-pro-image",
    });
  });
});
