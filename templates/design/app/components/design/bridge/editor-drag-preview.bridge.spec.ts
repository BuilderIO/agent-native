import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

describe("editor drag hierarchy preview", () => {
  it("inserts a valid flow reparent into the held preview", () => {
    expect(editorChromeBridgeScript).toContain(
      "placement,\n        insert: true",
    );
  });
});
