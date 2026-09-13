import { describe, expect, it } from "vitest";

import { resolveSvgExportIframe } from "./download-svg";

function previewIframe(screenId?: string) {
  return {
    screenId,
    getAttribute: (name: string) =>
      name === "data-screen-iframe-id" ? (screenId ?? null) : null,
  };
}

describe("resolveSvgExportIframe", () => {
  it("selects the active preview instead of an earlier board iframe", () => {
    const board = previewIframe();
    const active = previewIframe("screen-b::bp-390");
    const other = previewIframe("screen-a");

    expect(
      resolveSvgExportIframe([board, other, active], "screen-b::bp-390"),
    ).toBe(active);
  });

  it("does not export an unrelated preview when multiple frames are mounted", () => {
    const previews = [previewIframe(), previewIframe("screen-a")];

    expect(resolveSvgExportIframe(previews, "screen-b")).toBeNull();
  });

  it("uses the only preview when the active frame has no screen marker", () => {
    const preview = previewIframe();

    expect(resolveSvgExportIframe([preview], "board")).toBe(preview);
  });
});
