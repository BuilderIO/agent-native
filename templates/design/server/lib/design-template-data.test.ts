import { describe, expect, it } from "vitest";

import {
  firstTemplateDimensions,
  redactTemplateDesignData,
  remapTemplateFileIds,
} from "./design-template-data.js";

describe("design template data", () => {
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
