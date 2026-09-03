// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  collectOverviewAnnotationViewportMap,
  formatOverviewAnnotationMessage,
} from "./overview-annotation-context";

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("overview annotation context", () => {
  it("maps a stroke to a stable screen id/name using viewport-relative bounds", () => {
    const container = document.createElement("div");
    const home = document.createElement("div");
    home.dataset.frameId = "screen-home";
    container.append(home);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => rect(100, 50, 1000, 800),
    });
    Object.defineProperty(home, "getBoundingClientRect", {
      value: () => rect(220, 170, 300, 500),
    });

    const viewportMap = collectOverviewAnnotationViewportMap({
      container,
      screens: [{ id: "screen-home", name: "Home" }],
      zoom: 35,
    });
    expect(viewportMap.screens).toEqual([
      {
        id: "screen-home",
        name: "Home",
        x: 120,
        y: 120,
        width: 300,
        height: 500,
      },
    ]);

    const message = formatOverviewAnnotationMessage({
      designId: "design-1",
      designTitle: "Storefront",
      annotations: [
        {
          id: "stroke-1",
          type: "path",
          pathData: "M140.0,150.0 L180.0,190.0",
          color: "#ef4444",
          lineWidth: 4,
          position: { x: 0, y: 0 },
        },
      ],
      instruction: "Move this area down",
      viewportMap,
    });
    expect(message).toContain(
      "Home (screen-home): x=120.0, y=120.0, width=300.0, height=500.0",
    );
    expect(message).toContain("stroke regions=Home (screen-home)");
    expect(message).toContain("35.0% zoom");
  });
});
