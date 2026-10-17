import { describe, expect, it } from "vitest";

import { createMotionNativeStyleInstancesForTargets } from "./design-editor-view";

describe("createMotionNativeStyleInstancesForTargets", () => {
  it("creates the same preset at the playhead for every selected target", () => {
    const instances = createMotionNativeStyleInstancesForTargets({
      styleKey: "Position",
      targetNodeIds: ["card-one", "card-two"],
      timelineOffset: 375,
    });

    expect(
      instances.map(({ styleKey, targetNodeId, timelineOffset }) => [
        styleKey,
        targetNodeId,
        timelineOffset,
      ]),
    ).toEqual([
      ["Position", "card-one", 375],
      ["Position", "card-two", 375],
    ]);
  });
});
