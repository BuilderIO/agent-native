import { describe, expect, it } from "vitest";

import { renderFigmaHtml } from "./render-html.js";

describe("renderFigmaHtml", () => {
  it("renders top-level frames with inline image urls", () => {
    const result = renderFigmaHtml({
      filename: "checkout.fig",
      document: {
        children: [
          {
            id: "1:1",
            type: "FRAME",
            name: "Checkout",
            width: 360,
            height: 640,
            children: [
              {
                id: "1:2",
                type: "RECTANGLE",
                name: "Hero image",
                width: 320,
                height: 180,
                fills: [{ type: "IMAGE", imageRef: "abc" }],
              },
              {
                id: "1:3",
                type: "TEXT",
                name: "Title",
                characters: "Hello",
              },
            ],
          },
        ],
      },
      imageMap: new Map([["abc", "data:image/png;base64,AAAA"]]),
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filename).toBe("checkout.html");
    expect(result.files[0]!.width).toBe(360);
    expect(result.files[0]!.height).toBe(640);
    expect(result.files[0]!.content).toContain("data:image/png;base64,AAAA");
    expect(result.files[0]!.content).toContain("Hello");
    expect(result.warnings).toHaveLength(0);
  });

  it("warns for missing image refs", () => {
    const result = renderFigmaHtml({
      filename: "missing.fig",
      document: {
        children: [
          {
            type: "FRAME",
            name: "Frame",
            fills: [{ type: "IMAGE", imageRef: "missing-hash" }],
          },
        ],
      },
    });

    expect(result.warnings.join("\n")).toContain("missing-hash");
  });

  it("caps top-level frame imports", () => {
    const result = renderFigmaHtml({
      filename: "many.fig",
      document: {
        children: Array.from({ length: 30 }, (_, index) => ({
          type: "FRAME",
          name: `Frame ${index + 1}`,
        })),
      },
    });

    expect(result.files).toHaveLength(24);
    expect(result.warnings.join("\n")).toContain("Only the first 24");
  });

  it("imports a root-level frame as one screen", () => {
    const result = renderFigmaHtml({
      filename: "root.fig",
      document: {
        type: "FRAME",
        name: "Root Frame",
        children: [
          { type: "FRAME", name: "Nested Frame" },
          { type: "TEXT", characters: "Inside root" },
        ],
      },
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.source?.frameName).toBe("Root Frame");
    expect(result.files[0]!.content).toContain("Inside root");
  });
});
