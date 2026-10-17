import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { swapFillStrokePatch } from "./swap-fill-stroke";

function rect(
  computedStyles: Record<string, string>,
  inlineStyles: Record<string, string> = {},
): ElementInfo {
  return {
    tagName: "div",
    primitiveKind: "rectangle",
    classes: [],
    computedStyles,
    inlineStyles,
    boundingRect: { x: 0, y: 0, width: 57, height: 57 },
    isFlexChild: false,
    isFlexContainer: false,
  } as ElementInfo;
}

describe("swapFillStrokePatch", () => {
  it("trades a solid fill and a solid stroke, keeping stroke geometry", () => {
    expect(
      swapFillStrokePatch(
        rect({
          backgroundColor: "rgb(217, 217, 217)",
          borderWidth: "2px",
          borderStyle: "dashed",
          borderColor: "rgb(240, 137, 137)",
        }),
      ),
    ).toEqual({
      kind: "patch",
      patch: {
        backgroundColor: "rgb(240, 137, 137)",
        borderColor: "rgb(217, 217, 217)",
        borderWidth: "2px",
        borderStyle: "dashed",
      },
    });
  });

  it("moves a fill with no stroke into a new 1px solid stroke and empties the fill", () => {
    expect(
      swapFillStrokePatch(
        rect({
          backgroundColor: "rgb(217, 217, 217)",
          borderWidth: "0px",
          borderStyle: "none",
          borderColor: "rgb(17, 24, 39)",
        }),
      ),
    ).toEqual({
      kind: "patch",
      patch: {
        backgroundColor: "transparent",
        borderColor: "rgb(217, 217, 217)",
        borderWidth: "1px",
        borderStyle: "solid",
      },
    });
  });

  it("removes the stroke when there was no fill instead of leaving a hidden one", () => {
    expect(
      swapFillStrokePatch(
        rect({
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgb(255, 255, 255)",
        }),
      ),
    ).toEqual({
      kind: "patch",
      patch: {
        backgroundColor: "rgb(255, 255, 255)",
        borderWidth: "0px",
        borderStyle: "none",
      },
    });
  });

  it("moves a gradient fill to a border-area stroke layer and the stroke colour to the fill", () => {
    const result = swapFillStrokePatch(
      rect(
        {
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgb(255, 255, 255)",
        },
        {
          backgroundImage:
            "linear-gradient(90deg, #994848 0%, rgba(21, 21, 21, 0) 100%)",
        },
      ),
    );
    expect(result).toEqual({
      kind: "patch",
      patch: expect.objectContaining({
        backgroundColor: "rgb(255, 255, 255)",
        backgroundImage:
          "linear-gradient(90deg, #994848 0%, rgba(21, 21, 21, 0) 100%), none",
        backgroundClip: "border-area, border-box",
        backgroundOrigin: "border-box, padding-box",
        borderColor: "transparent",
        borderWidth: "1px",
        borderStyle: "solid",
      }),
    });
  });

  it("swaps back: a gradient stroke becomes the fill layer", () => {
    const result = swapFillStrokePatch(
      rect(
        {
          backgroundColor: "rgb(255, 255, 255)",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgba(0, 0, 0, 0)",
          backgroundClip: "border-area",
        },
        {
          backgroundImage:
            "linear-gradient(90deg, #994848 0%, rgba(21, 21, 21, 0) 100%)",
        },
      ),
    );
    expect(result).toEqual({
      kind: "patch",
      patch: expect.objectContaining({
        backgroundColor: "transparent",
        backgroundImage:
          "linear-gradient(90deg, #994848 0%, rgba(21, 21, 21, 0) 100%)",
        backgroundClip: "border-box",
        borderColor: "rgb(255, 255, 255)",
      }),
    });
  });

  it("refuses two fills, which a single-paint stroke cannot hold", () => {
    expect(
      swapFillStrokePatch(
        rect(
          { backgroundColor: "rgb(1, 2, 3)", borderWidth: "0px" },
          { backgroundImage: "linear-gradient(90deg, #fff 0%, #000 100%)" },
        ),
      ),
    ).toEqual({ kind: "unsupported-fill-paint" });
  });

  it("swaps a vector's svg fill and stroke paints", () => {
    expect(
      swapFillStrokePatch({
        ...rect({
          fill: "rgb(214, 84, 84)",
          stroke: "none",
          strokeWidth: "0px",
        }),
        tagName: "svg",
        primitiveKind: "path",
      }),
    ).toEqual({
      kind: "patch",
      patch: {
        "--an-vector-fill-gradient": "none",
        "--an-vector-stroke-gradient": "none",
        fill: "none",
        stroke: "rgb(214, 84, 84)",
        strokeWidth: "1px",
      },
    });
  });

  it("moves a vector stroke gradient to the fill, applied after the solid writes", () => {
    const result = swapFillStrokePatch({
      ...rect({
        fill: "rgb(214, 84, 84)",
        stroke: 'url("#v-stroke-gradient")',
        strokeWidth: "2px",
        "--an-vector-stroke-gradient":
          "linear-gradient(90deg, #f00 0%, #00f 100%)",
      }),
      tagName: "svg",
      primitiveKind: "path",
    });
    expect(result.kind).toBe("patch");
    const patch = result.kind === "patch" ? result.patch : {};
    expect(patch).toMatchObject({
      stroke: "rgb(214, 84, 84)",
      "--an-vector-fill-gradient": "linear-gradient(90deg, #f00 0%, #00f 100%)",
    });
    expect(Object.keys(patch).slice(-1)[0]).toBe("--an-vector-fill-gradient");
  });
});
