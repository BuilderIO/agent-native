import { describe, expect, it } from "vitest";

import {
  extractTemplateFonts,
  firstTemplateDimensions,
  readDesignTemplateSource,
  templateFileDimensions,
} from "./design-template-data.js";

describe("design template source", () => {
  it("reports a missing frame as unknown instead of borrowing a sibling frame", () => {
    const data = { canvasFrames: { a: { width: 1080, height: 1080 } } };

    expect(templateFileDimensions(data, "a")).toEqual({
      width: 1080,
      height: 1080,
    });
    expect(templateFileDimensions(data, "b")).toEqual({
      width: null,
      height: null,
    });
    // The older helper deliberately falls back, which is why the baseline uses
    // the exact lookup instead.
    expect(firstTemplateDimensions(data, "b")).toEqual({
      width: 1080,
      height: 1080,
    });
  });

  it("extracts declared and linked font families", () => {
    const fonts = extractTemplateFonts(
      [
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700">',
        "<style>",
        "body { font-family: Sora, sans-serif; }",
        "h1 { font-family: inherit; }",
        "p { font-family: var(--body); }",
        "</style>",
      ].join(""),
    );

    expect(fonts).toEqual(["Sora", "Playfair Display"]);
  });

  it("separates a design with no template from one that is unreadable", () => {
    expect(readDesignTemplateSource({})).toBeNull();
    expect(() =>
      readDesignTemplateSource({ templateSource: { title: "Campaign" } }),
    ).toThrow("readable templateId");
  });

  it("reads the captured dimensions and fonts a later turn depends on", () => {
    const source = readDesignTemplateSource({
      templateSource: {
        templateId: "saved-template",
        files: [
          {
            designFileId: "copied",
            templateFileId: "original",
            filename: "index.html",
            width: 1080,
            height: 1080,
          },
          { designFileId: "missing-template-file" },
        ],
        fonts: ["Sora", 7],
      },
    });

    expect(source?.files).toEqual([
      {
        designFileId: "copied",
        templateFileId: "original",
        filename: "index.html",
        width: 1080,
        height: 1080,
      },
    ]);
    expect(source?.fonts).toEqual(["Sora"]);
  });

  it("reads a design copied before the baseline was captured", () => {
    const source = readDesignTemplateSource({
      templateSource: { templateId: "saved-template", title: "Campaign" },
    });

    expect(source).toMatchObject({ templateId: "saved-template" });
    expect(source?.files).toEqual([]);
    expect(source?.fonts).toEqual([]);
  });
});
