import { describe, expect, it } from "vitest";

import {
  extractTemplateFonts,
  firstTemplateDimensions,
  redactTemplateDesignData,
  remapTemplateFileIds,
} from "./design-template-data.js";

describe("design template data", () => {
  it("captures quoted CSS font families", () => {
    const fonts = extractTemplateFonts(
      "<style>h1{font-family:\"DM Sans\", sans-serif} p{font-family: 'Helvetica Neue', sans-serif}</style>",
    );

    expect(fonts).toEqual(["DM Sans", "Helvetica Neue"]);
  });

  it("skips a malformed Google Fonts URL instead of throwing", () => {
    const fonts = extractTemplateFonts(
      '<link href="https://fonts.googleapis.com/css2?family=Sora&family=%E0%A4%A">',
    );

    expect(fonts).toEqual(["Sora"]);
  });

  it("remaps file-addressed canvas and screen metadata", () => {
    const data = remapTemplateFileIds(
      JSON.stringify({
        canvasFrames: { old: { width: 1080, height: 1080 } },
        screenMetadata: { old: { name: "Square" } },
        boardFileId: "old",
        lockedScreenIds: ["old"],
      }),
      new Map([["old", "new"]]),
    );

    expect(data).toMatchObject({
      canvasFrames: { new: { width: 1080, height: 1080 } },
      screenMetadata: { new: { name: "Square" } },
      boardFileId: "new",
      lockedScreenIds: ["new"],
    });
    expect(firstTemplateDimensions(data, "new")).toEqual({
      width: 1080,
      height: 1080,
    });
  });

  it("redacts localhost credentials before template persistence or reuse", () => {
    const redacted = redactTemplateDesignData(
      JSON.stringify({
        screenMetadata: {
          screen: {
            sourceType: "localhost",
            connectionId: "connection-example",
            bridgeUrl: "http://127.0.0.1:7331",
            bridgeToken: "example-private-bridge-token",
            previewToken: "example-private-preview-token",
            nested: { bridgeToken: "example-nested-token" },
          },
        },
      }),
    );

    expect(redacted).toContain("connection-example");
    expect(redacted).toContain("bridgeUrl");
    expect(redacted).not.toContain("bridgeToken");
    expect(redacted).not.toContain("previewToken");
    expect(redacted).not.toContain("example-private");
  });
});
