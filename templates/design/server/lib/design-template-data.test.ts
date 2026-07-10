import { describe, expect, it } from "vitest";

import {
  firstTemplateDimensions,
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
});
