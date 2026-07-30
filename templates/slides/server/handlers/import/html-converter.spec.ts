import { describe, expect, it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";

describe("PPTX HTML conversion", () => {
  it("keeps source paragraphs and every image visible", () => {
    const html = convertToSlideHtml(
      {
        texts: [
          { content: "Title", paragraph: 0, bold: true },
          { content: " with emphasis", paragraph: 0, italic: true },
          { content: "Body", paragraph: 1 },
        ],
        images: [
          { data: new Uint8Array([1]), mimeType: "image/png", name: "one.png" },
          { data: new Uint8Array([2]), mimeType: "image/png", name: "two.png" },
        ],
        layoutHint: "image",
      },
      ["https://cdn.example/one.png", undefined],
      "Inter",
    );

    expect(html).toContain("https://cdn.example/one.png");
    expect(html).toContain("Imported image: two.png");
    expect(html).toContain("Title");
    expect(html).toContain("with emphasis");
    expect(html).toContain("Body");
    expect(html).toContain("font-family: 'Inter', sans-serif");
    expect(html).not.toContain("Title with emphasisBody");
  });
});
