import { beforeEach, describe, expect, it } from "vitest";

import type { SlideStyleSnapshot } from "./slide-style";
import {
  copiedElementStyleFromSnapshot,
  getCopiedElementStyle,
  setCopiedElementStyle,
} from "./style-clipboard";

const snapshot: SlideStyleSnapshot = {
  selector: "[data-builder-id=title]",
  label: "title",
  tagName: "h1",
  textPreview: "A title",
  isText: true,
  isImage: false,
  isAbsolute: true,
  x: 100,
  y: 120,
  width: 480,
  height: 72,
  rotation: 14,
  slideWidth: 1280,
  slideHeight: 720,
  color: "rgb(255, 255, 255)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  fontSize: 18,
  fontWeight: "700",
  fontStyle: "italic",
  textDecoration: "underline",
  lineHeight: 1.4,
  textAlign: "center",
  opacity: 80,
  borderRadius: 6,
  borderWidth: 2,
  borderColor: "rgb(96, 159, 248)",
  paddingX: 12,
  paddingY: 8,
  zIndex: 3,
  listKind: null,
};

describe("element style clipboard", () => {
  beforeEach(() => setCopiedElementStyle(null));

  it("copies appearance without copying geometry or stacking order", () => {
    expect(copiedElementStyleFromSnapshot(snapshot)).toEqual({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "18px",
      fontWeight: "700",
      fontStyle: "italic",
      textDecoration: "underline",
      lineHeight: "1.4",
      textAlign: "center",
      opacity: "0.8",
      borderRadius: "6px",
      borderWidth: "2px",
      borderColor: "rgb(96, 159, 248)",
      paddingLeft: "12px",
      paddingRight: "12px",
      paddingTop: "8px",
      paddingBottom: "8px",
    });
  });

  it("returns defensive copies so later edits cannot mutate the clipboard", () => {
    setCopiedElementStyle(copiedElementStyleFromSnapshot(snapshot));
    const firstRead = getCopiedElementStyle();
    expect(firstRead).not.toBeNull();

    firstRead!.color = "red";

    expect(getCopiedElementStyle()?.color).toBe("rgb(255, 255, 255)");
  });
});
