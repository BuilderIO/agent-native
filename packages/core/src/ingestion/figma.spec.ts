import { describe, expect, it } from "vitest";

import { summarizeFigmaNode } from "./figma.js";

describe("summarizeFigmaNode", () => {
  it("preserves the visual, layout, and text details used by design context", () => {
    const result = summarizeFigmaNode({
      id: "frame:1",
      name: "Card",
      type: "COMPONENT",
      absoluteBoundingBox: { x: 1, y: 2, width: 200, height: 100 },
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "MAX",
      layoutWrap: "WRAP",
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      itemSpacing: 12,
      paddingTop: 8,
      paddingRight: 10,
      paddingBottom: 8,
      paddingLeft: 10,
      rectangleCornerRadii: [4, 8, 12, 16],
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }],
      strokeWeight: 2,
      strokeAlign: "INSIDE",
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 12,
          spread: 1,
        },
      ],
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientHandlePositions: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0 } },
            { position: 1, color: { r: 0, g: 0, b: 1 } },
          ],
        },
      ],
      children: [
        {
          id: "text:1",
          name: "Label",
          type: "TEXT",
          characters: "Button",
          style: {
            fontFamily: "Inter",
            fontWeight: 600,
            fontSize: 16,
            lineHeightPx: 20,
            lineHeightPercent: 125,
            letterSpacing: 0.2,
            textAlignHorizontal: "CENTER",
            textCase: "UPPER",
            textDecoration: "UNDERLINE",
          },
        },
      ],
    });

    expect(result.node).toMatchObject({
      cornerRadius: [4, 8, 12, 16],
      isComponent: true,
      layout: {
        mode: "HORIZONTAL",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "MAX",
        wrap: "WRAP",
        sizingHorizontal: "FILL",
        sizingVertical: "HUG",
      },
      strokes: {
        paints: [{ type: "solid", color: "#000000", opacity: 0.5 }],
        weight: 2,
        align: "INSIDE",
      },
      effects: [
        {
          type: "drop-shadow",
          color: "#00000040",
          offset: { x: 0, y: 4 },
          radius: 12,
          spread: 1,
        },
      ],
      fills: [
        {
          type: "linear-gradient",
          angleDeg: 90,
          stops: [
            { position: 0, color: "#FF0000" },
            { position: 1, color: "#0000FF" },
          ],
        },
      ],
      children: [
        {
          text: {
            characters: "Button",
            lineHeightPercent: 125,
            textAlignHorizontal: "CENTER",
            textCase: "UPPER",
            textDecoration: "UNDERLINE",
          },
        },
      ],
    });
  });
});
