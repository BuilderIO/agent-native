import { describe, expect, it } from "vitest";

import action from "./generate-asset.js";

describe("generate-asset", () => {
  it("returns an auto-generating picker immediately for image requests", async () => {
    const result = await action.run({
      prompt: "A polished landing page hero image",
      count: "3",
      includeLogo: "true",
      callerAppId: "design",
    } as any);

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
      "/library?mediaType=image&prompt=A+polished+landing+page+hero+image&aspectRatio=16%3A9&includeLogo=1&callerAppId=design&autoGenerate=1",
    );
    expect(result.message).toContain("no libraries");
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
