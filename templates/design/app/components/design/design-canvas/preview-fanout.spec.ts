import { describe, expect, it } from "vitest";

import {
  previewReplacersFor,
  registerPreviewReplacer,
  type PreviewReplacer,
} from "./preview-fanout";

const noop: PreviewReplacer = () => true;

describe("which canvases receive a host preview push", () => {
  it("includes every canvas mounted for one screen, not just the last", () => {
    const primary: PreviewReplacer = () => true;
    const breakpoint: PreviewReplacer = () => true;
    const off = [
      registerPreviewReplacer("screen-1", primary),
      registerPreviewReplacer("screen-1", breakpoint),
    ];

    expect(previewReplacersFor("screen-1", primary)).toEqual([
      primary,
      breakpoint,
    ]);

    off.forEach((unregister) => unregister());
  });

  it("puts the primary first so its result is the reported one", () => {
    const primary: PreviewReplacer = () => true;
    const off = [
      registerPreviewReplacer("screen-1", noop),
      registerPreviewReplacer("screen-1", primary),
    ];

    expect(previewReplacersFor("screen-1", primary)[0]).toBe(primary);

    off.forEach((unregister) => unregister());
  });

  it("never sends one screen's edit to another screen's canvas", () => {
    const mine: PreviewReplacer = () => true;
    const theirs: PreviewReplacer = () => true;
    const off = [
      registerPreviewReplacer("screen-1", mine),
      registerPreviewReplacer("screen-2", theirs),
    ];

    expect(previewReplacersFor("screen-1")).toEqual([mine]);

    off.forEach((unregister) => unregister());
  });

  it("drops a canvas once it unmounts", () => {
    const off = registerPreviewReplacer("screen-1", noop);
    off();

    expect(previewReplacersFor("screen-1")).toEqual([]);
  });

  it("reports nothing for a screen with no canvas, so the caller can fail", () => {
    expect(previewReplacersFor("never-mounted")).toEqual([]);
    expect(previewReplacersFor(null)).toEqual([]);
  });
});
