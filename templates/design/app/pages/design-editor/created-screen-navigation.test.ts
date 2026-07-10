import { describe, expect, it } from "vitest";

import { getCreatedScreenNavigationPlan } from "./created-screen-navigation";

describe("getCreatedScreenNavigationPlan", () => {
  it("selects, activates, and fits the new screen in one overview transition", () => {
    expect(
      getCreatedScreenNavigationPlan({
        screenId: "screen-new",
        geometry: { x: 752, y: -40, width: 320, height: 640 },
      }),
    ).toEqual({
      activeFileId: "screen-new",
      selectedLayerIds: ["screen-new"],
      selectedScreenIds: ["screen-new"],
      viewMode: "overview",
      camera: {
        fitBounds: {
          left: 752,
          top: -40,
          right: 1072,
          bottom: 600,
          width: 320,
          height: 640,
          centerX: 912,
          centerY: 280,
        },
        paddingScreenPx: 96,
      },
    });
  });

  it("normalizes degenerate dimensions before issuing a camera fit", () => {
    const plan = getCreatedScreenNavigationPlan({
      screenId: "screen-new",
      geometry: { x: 12, y: 18, width: 0, height: -4 },
      paddingScreenPx: 140,
    });

    expect(plan.camera).toEqual({
      fitBounds: {
        left: 12,
        top: 18,
        right: 13,
        bottom: 19,
        width: 1,
        height: 1,
        centerX: 12.5,
        centerY: 18.5,
      },
      paddingScreenPx: 140,
    });
  });
});
