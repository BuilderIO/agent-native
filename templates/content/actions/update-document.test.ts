import { describe, expect, it } from "vitest";

import {
  isEffectivelyEmptyDocumentContent,
  isStaleBuilderImageSourceComponentSave,
  shouldRejectStaleEmptyBodySave,
} from "./update-document";

describe("update document", () => {
  it("rejects stale empty body saves but allows a current legitimate clear", () => {
    expect(
      shouldRejectStaleEmptyBodySave({
        incomingContent: "<empty-block/>",
        currentContent: "Hydrated Builder body",
        loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
        currentUpdatedAt: "2026-07-02T12:00:02.000Z",
      }),
    ).toBe(true);

    expect(
      shouldRejectStaleEmptyBodySave({
        incomingContent: "<empty-block/>",
        currentContent: "Hydrated Builder body",
        loadedUpdatedAt: "2026-07-02T12:00:02.000Z",
        currentUpdatedAt: "2026-07-02T12:00:02.000Z",
      }),
    ).toBe(false);

    expect(isEffectivelyEmptyDocumentContent("<empty-block/>")).toBe(true);
    expect(isEffectivelyEmptyDocumentContent("Real content")).toBe(false);
  });

  it("rejects equal-timestamp empty saves when the client attests it loaded empty content", () => {
    expect(
      shouldRejectStaleEmptyBodySave({
        incomingContent: "<empty-block/>",
        currentContent: "Hydrated Builder body",
        loadedUpdatedAt: "2026-07-02T12:00:02.000Z",
        currentUpdatedAt: "2026-07-02T12:00:02.000Z",
        loadedContentWasEmpty: true,
      }),
    ).toBe(true);

    expect(
      shouldRejectStaleEmptyBodySave({
        incomingContent: "<empty-block/>",
        currentContent: "Hydrated Builder body",
        loadedUpdatedAt: "2026-07-02T12:00:02.000Z",
        currentUpdatedAt: "2026-07-02T12:00:02.000Z",
        loadedContentWasEmpty: false,
      }),
    ).toBe(false);
  });

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
