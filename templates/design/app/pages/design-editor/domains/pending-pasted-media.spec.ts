import { describe, expect, it } from "vitest";

import { cancelRemovedPendingPastedMedia } from "./pending-pasted-media";

describe("cancelRemovedPendingPastedMedia", () => {
  it("cancels only pending nodes removed by the replayed content", () => {
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

    cancelRemovedPendingPastedMedia(
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
});
