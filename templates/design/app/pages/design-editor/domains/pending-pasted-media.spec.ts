import { describe, expect, it } from "vitest";

import { cancelPendingPastedMediaAbsentFromContent } from "./pending-pasted-media";

describe("cancelPendingPastedMediaAbsentFromContent", () => {
  it("cancels pending nodes absent from content", () => {
    const pendingByScreen = new Map([
      [
        "screen-1",
        new Map([
          ["kept-image", false],
          ["removed-image", false],
          ["preview-only-image", false],
        ]),
      ],
      ["screen-2", new Map([["other-screen-image", false]])],
    ]);

    cancelPendingPastedMediaAbsentFromContent(
      pendingByScreen,
      "screen-1",
      '<!doctype html><html><body><img data-agent-native-node-id="kept-image"></body></html>',
    );

    expect(pendingByScreen.get("screen-1")).toEqual(
      new Map([
        ["kept-image", false],
        ["removed-image", true],
        ["preview-only-image", true],
      ]),
    );
    expect(pendingByScreen.get("screen-2")).toEqual(
      new Map([["other-screen-image", false]]),
    );
  });

  it("preserves pending preview media that remains in content", () => {
    const pendingByScreen = new Map([
      [
        "screen-1",
        new Map([
          ["preview-kept", false],
          ["preview-removed", false],
        ]),
      ],
      ["screen-2", new Map([["other-screen-image", false]])],
    ]);

    cancelPendingPastedMediaAbsentFromContent(
      pendingByScreen,
      "screen-1",
      '<main><img data-agent-native-node-id="preview-kept"></main>',
    );

    expect(pendingByScreen.get("screen-1")).toEqual(
      new Map([
        ["preview-kept", false],
        ["preview-removed", true],
      ]),
    );
    expect(pendingByScreen.get("screen-2")).toEqual(
      new Map([["other-screen-image", false]]),
    );
  });
});
