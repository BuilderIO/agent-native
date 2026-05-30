import { describe, expect, it } from "vitest";

import action from "./open-asset-picker.js";

describe("open-asset-picker", () => {
  it("defaults to image picker metadata", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      app: "assets",
      view: "picker",
      mediaType: "image",
      path: "/picker?mediaType=image",
      url: "/picker?mediaType=image",
      embed: true,
      count: 3,
      autoGenerate: false,
    });
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.mcpApp?.compactCatalog).toBe(true);
    expect(action.mcpApp?.resource.title).toBe("Assets picker");
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
      path: "/picker?mediaType=video&q=launch+clip&libraryId=lib_123&aspectRatio=16%3A9&presetId=preset_hero&count=4&autoGenerate=1",
      presetId: "preset_hero",
      count: 4,
      autoGenerate: true,
    });
    expect(link).toEqual({
      url: result.url,
      label: "Open Assets picker",
      view: "picker",
    });
  });
});
