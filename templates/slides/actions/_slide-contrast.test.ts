import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock("./get-design-system.js", () => ({
  default: { run: mockRun },
}));

import { slideContrastWarning } from "./_slide-contrast";

/** Light text, no canvas of its own: readable only on a dark canvas. */
const lightText =
  '<div class="fmd-slide"><h1 style="color: #F5F2EA;">Moon</h1></div>';

describe("slideContrastWarning", () => {
  beforeEach(() => {
    mockRun.mockReset();
  });

  it("audits an unlinked slide against the default canvas", async () => {
    // The renderer paints the built-in canvas here, so light text on it is as
    // unreadable as it would be on a light design system's.
    const warning = await slideContrastWarning({ html: lightText });

    expect(warning).toContain("unreadable as written");
    expect(warning).toContain("#f5f2ea");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("audits against the linked system's canvas", async () => {
    mockRun.mockResolvedValue({
      id: "ds-dark",
      colorMode: { background: "#0B0E14" },
    });

    expect(
      await slideContrastWarning({
        html: lightText,
        designSystemId: "ds-dark",
      }),
    ).toBeNull();
  });

  it("falls back to the full read for a Builder-linked system", async () => {
    // Builder keeps token values behind the docs fetch the compact read skips,
    // so the compact result knows the system is Builder-linked but not its
    // canvas. Stopping there left those slides unaudited.
    mockRun
      .mockResolvedValueOnce({
        id: "ds-builder",
        builderDesignSystemId: "builder-1",
        colorMode: null,
      })
      .mockResolvedValueOnce({
        id: "ds-builder",
        colorMode: { background: "#101418" },
      });

    expect(
      await slideContrastWarning({
        html: lightText,
        designSystemId: "ds-builder",
      }),
    ).toBeNull();
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenLastCalledWith({
      id: "ds-builder",
      compact: "false",
    });
  });

  it("leaves a slide that names its own canvas to that canvas", async () => {
    // `bg-slate-900` carries no CSS value here. Inheriting over it would audit
    // the slide against a canvas it does not render on.
    expect(
      await slideContrastWarning({
        html: lightText,
        background: "bg-slate-900",
        designSystemId: "ds-light",
      }),
    ).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("keeps the markup-only report when the canvas cannot be read", async () => {
    mockRun.mockResolvedValue({ id: "ds-vars", colorMode: null });

    expect(
      await slideContrastWarning({
        html: lightText,
        designSystemId: "ds-vars",
      }),
    ).toBeNull();
  });
});
