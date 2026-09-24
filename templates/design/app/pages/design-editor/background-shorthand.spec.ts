import { buildCodeLayerProjection } from "@shared/code-layer";
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { mixedElementFromSelection } from "@/components/design/edit-panel/selection-helpers";
import type { ElementInfo } from "@/components/design/types";

import {
  cssStyleAliases,
  elementInfoFromCodeLayerNode,
  refreshedComputedStyles,
} from "./code-layer-state";

describe("background shorthand in source-backed selections", () => {
  it("preserves a drawn shape's authored hex fill before bridge measurement", () => {
    expect(cssStyleAliases({ background: "#dadada" }).backgroundColor).toBe(
      "#dadada",
    );
  });

  it("preserves declaration order between shorthand and longhand", () => {
    expect(
      cssStyleAliases({ background: "red", "background-color": "blue" })
        .backgroundColor,
    ).toBe("blue");
    expect(
      cssStyleAliases({ "background-color": "blue", background: "red" })
        .backgroundColor,
    ).toBe("red");
  });

  it("uses the original style attribute order when expanding backgrounds", () => {
    const expanded = cssStyleAliases(
      { background: "red", "background-color": "blue" },
      "background-color: blue; background: red",
    );
    expect(expanded.backgroundColor).toBe("red");
  });

  it("treats equal main and pasted shorthand paint as common, but keeps different blue mixed", () => {
    const infoFrom = (style: string, nodeId: string) => {
      const projection = buildCodeLayerProjection(
        `<html><body><button data-agent-native-node-id="${nodeId}" style="${style}"><span data-an-text>Shared action</span></button></body></html>`,
      );
      const node = projection.nodes.find(
        (candidate) =>
          candidate.attributes["data-agent-native-node-id"] === nodeId,
      );
      if (!node) throw new Error(`Missing projected node ${nodeId}`);
      return elementInfoFromCodeLayerNode(node);
    };
    const main = infoFrom("background-color:#2f74f5;color:#fff", "main");
    const pasted = infoFrom(
      "background: none 0% 0% / auto repeat scroll padding-box border-box rgb(47, 116, 245); color: rgb(255, 255, 255)",
      "pasted",
    );

    expect(main.computedStyles.backgroundColor).toBe("rgb(47, 116, 245)");
    expect(pasted.computedStyles.backgroundColor).toBe("rgb(47, 116, 245)");
    expect(main.computedStyles.backgroundImage).toBe("none");
    expect(main.computedStyles.backgroundPosition).toBe("0% 0%");
    expect(main.computedStyles.backgroundSize).toBe("auto");
    expect(main.computedStyles.backgroundRepeat).toBe("repeat");

    const common = mixedElementFromSelection([main, pasted]);
    expect(common?.computedStyles.backgroundColor).toBe("rgb(47, 116, 245)");
    expect(common?.computedStyles.backgroundImage).toBe("none");
    expect(common?.computedStyles.backgroundPosition).toBe("0% 0%");
    expect(common?.computedStyles.backgroundSize).toBe("auto");
    expect(common?.computedStyles.backgroundRepeat).toBe("repeat");

    const differentBlue = infoFrom(
      "background: none 0% 0% / auto repeat scroll padding-box border-box rgb(59, 130, 246); color: rgb(255, 255, 255)",
      "other-blue",
    );
    expect(
      mixedElementFromSelection([main, differentBlue])?.computedStyles
        .backgroundColor,
    ).toBe("Mixed");
  });

  it("preserves measured class paint when inline source changes only a longhand or unrelated style", () => {
    const classPaint: ElementInfo = {
      tagName: "div",
      classes: ["paint"],
      computedStyles: {
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
        backgroundPosition: "center center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        padding: "2px",
        width: "100px",
      },
      boundingRect: { x: 0, y: 0, width: 100, height: 50 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    const longhandUpdate = refreshedComputedStyles(
      classPaint,
      { "background-color": "#2f74f5", padding: "4px" },
      ["paint"],
      "background-color: #2f74f5; padding: 4px",
    );
    expect(longhandUpdate.backgroundColor).toBe("rgb(47, 116, 245)");
    expect(longhandUpdate.backgroundImage).toBe(
      "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
    );
    expect(longhandUpdate.backgroundPosition).toBe("center center");
    expect(longhandUpdate.backgroundSize).toBe("cover");
    expect(longhandUpdate.backgroundRepeat).toBe("no-repeat");
    expect(longhandUpdate.padding).toBe("4px");

    const sizeOnlyUpdate = refreshedComputedStyles(
      classPaint,
      { padding: "8px", width: "120px" },
      ["paint"],
      "padding: 8px; width: 120px",
    );
    expect(sizeOnlyUpdate.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(sizeOnlyUpdate.backgroundImage).toBe(
      "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
    );
    expect(sizeOnlyUpdate.width).toBe("120px");

    const shorthandReset = refreshedComputedStyles(
      classPaint,
      { background: "red" },
      ["paint"],
      "background: red",
    );
    expect(shorthandReset.backgroundColor).toBe("red");
    expect(shorthandReset.backgroundImage).toBe("none");
    expect(shorthandReset.backgroundPosition).toBe("0% 0%");
    expect(shorthandReset.backgroundSize).toBe("auto");
    expect(shorthandReset.backgroundRepeat).toBe("repeat");
  });

  it("refreshes the fill when class-less source styles replace a live snapshot", () => {
    const info: ElementInfo = {
      tagName: "div",
      classes: [],
      computedStyles: { backgroundColor: "red" },
      boundingRect: { x: 0, y: 0, width: 100, height: 50 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    expect(
      refreshedComputedStyles(info, { background: "blue" }, []).backgroundColor,
    ).toBe("blue");
  });
});
