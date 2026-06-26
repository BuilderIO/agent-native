import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppStateMock = vi.hoisted(() => vi.fn());
const getRequestRunContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: writeAppStateMock,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: getRequestRunContextMock,
}));

import action from "./generate-asset.js";

describe("generate-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeAppStateMock.mockResolvedValue(undefined);
    getRequestRunContextMock.mockReturnValue(undefined);
  });

  it("returns an auto-generating picker immediately for image requests", async () => {
    getRequestRunContextMock.mockReturnValue({ browserTabId: "assets-tab" });

    const result = await action.run(
      {
        prompt: "A polished landing page hero image",
        count: "3",
        includeLogo: "true",
        callerAppId: "design",
      } as any,
      { caller: "tool" } as any,
    );

    expect(result).toMatchObject({
      app: "assets",
      view: "picker",
      mediaType: "image",
      count: 3,
      autoGenerate: true,
      includeLogo: true,
      callerAppId: "design",
      generated: false,
      generationStarted: false,
      generationMode: "picker-auto-generate",
    });
    expect(result.path).toBe(
      "/library?__an_picker=1&mediaType=image&prompt=A+polished+landing+page+hero+image&aspectRatio=16%3A9&includeLogo=1&callerAppId=design&autoGenerate=1",
    );
    expect(result.message).toContain("no libraries");
    expect(writeAppStateMock).toHaveBeenCalledWith(
      "navigate:assets-tab",
      expect.objectContaining({
        view: "picker",
        mediaType: "image",
        path: result.path,
      }),
    );
  });

  it("passes MCP context through to the picker without navigating", async () => {
    getRequestRunContextMock.mockReturnValue({ browserTabId: "design-tab" });

    const result = await action.run(
      {
        prompt: "A polished landing page hero image",
        callerAppId: "design",
      },
      { caller: "mcp" } as any,
    );

    expect(result).toMatchObject({
      app: "assets",
      view: "picker",
      embed: true,
      callerAppId: "design",
      autoGenerate: true,
    });
    expect(writeAppStateMock).not.toHaveBeenCalled();
  });

  it("advertises count as integer or string for MCP hosts that stringify args", () => {
    expect(action.tool.parameters?.properties?.count).toMatchObject({
      anyOf: [
        expect.objectContaining({ type: "integer" }),
        expect.objectContaining({ type: "string", pattern: "^[1-6]$" }),
      ],
    });
  });

  it("does not require a pre-existing library id", async () => {
    await expect(
      action.run({
        prompt: "A quiet product-card background",
      }),
    ).resolves.toMatchObject({
      app: "assets",
      libraryId: null,
      autoGenerate: true,
    });
  });
});
