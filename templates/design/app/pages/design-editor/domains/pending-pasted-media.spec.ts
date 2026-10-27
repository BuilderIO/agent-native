import { describe, expect, it } from "vitest";

import { cancelPendingPastedMediaRemovedByReplay } from "./pending-pasted-media";

describe("cancelPendingPastedMediaRemovedByReplay", () => {
  it("cancels only pending nodes removed by the replay", () => {
    const pendingByScreen = new Map([
      [
        "screen-1",
        new Map([
          ["kept-image", false],
          ["removed-image", false],
          ["not-in-source", false],
        ]),
      ],
      ["screen-2", new Map([["other-screen-image", false]])],
    ]);

    cancelPendingPastedMediaRemovedByReplay(
      pendingByScreen,
      "screen-1",
      '<!doctype html><html><body><img data-agent-native-node-id="kept-image"><img data-agent-native-node-id="removed-image"></body></html>',
      '<!doctype html><html><body><img data-agent-native-node-id="kept-image"></body></html>',
    );

    expect(pendingByScreen.get("screen-1")).toEqual(
      new Map([
        ["kept-image", false],
        ["removed-image", true],
        ["not-in-source", false],
      ]),
    );
    expect(pendingByScreen.get("screen-2")).toEqual(
      new Map([["other-screen-image", false]]),
    );
  });

  it("preserves pending preview media that remains in replayed content", () => {
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

    cancelPendingPastedMediaRemovedByReplay(
      pendingByScreen,
      "screen-1",
      '<main><img data-agent-native-node-id="preview-kept"><img data-agent-native-node-id="preview-removed"></main>',
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
