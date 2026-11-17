import { afterEach, describe, expect, it, vi } from "vitest";

import { describePasteWarnings } from "./warnings";

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options ? JSON.stringify(options) : ""}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describePasteWarnings", () => {
  it("says nothing when nothing was lost", () => {
    expect(describePasteWarnings([], "paper", t)).toEqual([]);
  });

  it("totals each kind into one localized line, most actionable first", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lines = describePasteWarnings(
      [
        { kind: "inexact", detail: "a" },
        { kind: "inexact", detail: "b" },
        { kind: "layer-type", type: "Ellipse" },
        { kind: "layer-type", type: "Ellipse" },
        { kind: "image-placeholders", count: 2 },
        { kind: "images-linked", count: 3, reason: "storage offline" },
        { kind: "images-unsaved", count: 4 },
      ],
      "wonder",
      t,
    );
    expect(lines).toEqual([
      'designEditor.import.pasteImagesUnsaved{"count":4,"tool":"Wonder"}',
      'designEditor.import.pasteImagesLinked{"count":3,"tool":"Wonder"}',
      'designEditor.import.pasteImagePlaceholders{"count":2,"tool":"Wonder"}',
      'designEditor.import.pasteLayerTypes{"count":1,"tool":"Wonder"}',
      'designEditor.import.pasteInexact{"count":2}',
    ]);
  });

  it("logs the technical detail for the console, not the toast", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lines = describePasteWarnings(
      [
        { kind: "inexact", detail: 'Skipped the unsupported "x" style.' },
        { kind: "images-linked", count: 1, reason: "storage offline" },
      ],
      "paper",
      t,
    );
    expect(lines.join(" ")).not.toContain("storage offline");
    expect(warn).toHaveBeenCalledWith("[design-paste] Paper:", [
      'Skipped the unsupported "x" style.',
      "storage offline",
    ]);
  });
});
