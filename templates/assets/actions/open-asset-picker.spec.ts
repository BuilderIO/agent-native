import { describe, expect, it } from "vitest";

import action from "./open-asset-picker.js";

describe("open-asset-picker", () => {
  it("defaults to image picker metadata", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      app: "assets",
      view: "picker",
      mediaType: "image",
      path: "/library?mediaType=image",
      url: "/library?mediaType=image",
      embed: true,
      count: 3,
      autoGenerate: false,
      fallbackInstructions: expect.stringContaining("paste"),
    });
    expect(result.message).toContain("browser tab");
    expect(result.message).toContain("paste");
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.mcpApp?.compactCatalog).toBe(true);
    expect(action.mcpApp?.resource.title).toBe("Assets Library picker");
  });

  it("passes video media type, query, and fallback deep link", async () => {
    const args = {
      mediaType: "video" as const,
      query: "launch clip",
      libraryId: "lib_123",
      aspectRatio: "16:9",
      presetId: "preset_hero",
      count: 4,
      autoGenerate: true,
    };
    const result = await action.run(args);
    const link = action.link?.({ args, result });

    expect(result).toMatchObject({
      mediaType: "video",
      path: "/library?mediaType=video&q=launch+clip&libraryId=lib_123&aspectRatio=16%3A9&presetId=preset_hero&count=4&autoGenerate=1",
      url: "/library?mediaType=video&q=launch+clip&libraryId=lib_123&aspectRatio=16%3A9&presetId=preset_hero&count=4&autoGenerate=1",
      message: expect.stringContaining("paste"),
      fallbackInstructions: expect.stringContaining("handoff summary"),
      presetId: "preset_hero",
      count: 4,
      autoGenerate: true,
    });
    expect(result.url).not.toContain("/asset/");
    expect(link).toEqual({
      url: result.url,
      label: "Open Assets Library picker",
      view: "picker",
    });
  });

  it("accepts MCP stringified scalar parameters", async () => {
    const result = await action.run({
      prompt: "Generate a hero image",
      count: "4",
      autoGenerate: "true",
      includeLogo: "false",
      styleStrength: "strong",
      tier: "fast",
      callerAppId: "design",
    } as any);

    expect(result).toMatchObject({
      count: 4,
      autoGenerate: true,
      includeLogo: false,
      styleStrength: "strong",
      tier: "fast",
      callerAppId: "design",
    });
    expect(result.path).toBe(
      "/library?mediaType=image&prompt=Generate+a+hero+image&count=4&tier=fast&styleStrength=strong&callerAppId=design&autoGenerate=1",
    );
  });

  it("advertises count as integer or string for MCP hosts that stringify args", () => {
    expect(action.tool.parameters?.properties?.count).toMatchObject({
      anyOf: [
        expect.objectContaining({ type: "integer" }),
        expect.objectContaining({ type: "string", pattern: "^[1-6]$" }),
      ],
    });
  });

  it("does not treat string false as truthy", async () => {
    const result = await action.run({
      prompt: "Generate a hero image",
      autoGenerate: "false",
      includeLogo: "false",
    } as any);

    expect(result).toMatchObject({
      autoGenerate: false,
      includeLogo: false,
    });
    expect(result.path).toBe(
      "/library?mediaType=image&prompt=Generate+a+hero+image",
    );
  });
});
