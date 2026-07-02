import { describe, expect, it } from "vitest";

import { isStaleBuilderImageSourceComponentSave } from "./update-document";

describe("update document", () => {
  it("detects stale Builder image marker saves after readable image hydration", () => {
    const sourceContent =
      "Opening paragraph.\n\n![Diagram](https://cdn.builder.io/image.png)\n\nClosing paragraph.";
    expect(
      isStaleBuilderImageSourceComponentSave({
        incomingContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        currentContent: sourceContent,
        sourceContent,
      }),
    ).toBe(true);

    expect(
      isStaleBuilderImageSourceComponentSave({
        incomingContent:
          'Opening paragraph with a local edit.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        currentContent: sourceContent,
        sourceContent,
      }),
    ).toBe(false);

    expect(
      isStaleBuilderImageSourceComponentSave({
        incomingContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        currentContent:
          "Opening paragraph.\r\n\r\n![Diagram](https://cdn.builder.io/image.png)\r\n\r\nClosing paragraph.\n",
        sourceContent,
      }),
    ).toBe(true);

    expect(
      isStaleBuilderImageSourceComponentSave({
        incomingContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        currentContent:
          'Opening paragraph.\n\n<SourceComponent componentName="Image" previewUrl={"https://cdn.builder.io/image.png"} />\n\nClosing paragraph.',
        sourceContent,
      }),
    ).toBe(false);
  });
});
