import { describe, expect, it } from "vitest";

import { isOsFileDragEvent } from "./design-canvas/file-drop";

function dragEventWithTypes(types: string[]) {
  return {
    dataTransfer: {
      types: types as unknown as DOMStringList,
    },
  };
}

describe("isOsFileDragEvent", () => {
  it("returns true when dataTransfer.types includes Files", () => {
    expect(isOsFileDragEvent(dragEventWithTypes(["Files"]))).toBe(true);
  });

  it("returns true when Files is present alongside other types", () => {
    expect(isOsFileDragEvent(dragEventWithTypes(["text/plain", "Files"]))).toBe(
      true,
    );
  });

  it("returns false for an internal DOM drag with only text/plain", () => {
    expect(isOsFileDragEvent(dragEventWithTypes(["text/plain"]))).toBe(false);
  });

  it("returns false when types is empty", () => {
    expect(isOsFileDragEvent(dragEventWithTypes([]))).toBe(false);
  });

  it("returns false when dataTransfer is null", () => {
    expect(isOsFileDragEvent({ dataTransfer: null })).toBe(false);
  });

  it("works with a real DOMStringList-like object exposing only length/item/contains", () => {
    const domStringListLike = {
      length: 2,
      0: "text/uri-list",
      1: "Files",
      item(index: number) {
        return (this as Record<number, string>)[index] ?? null;
      },
      contains(value: string) {
        return value === "text/uri-list" || value === "Files";
      },
    };
    expect(
      isOsFileDragEvent({
        dataTransfer: {
          types: domStringListLike as unknown as DOMStringList,
        },
      }),
    ).toBe(true);
  });
});
