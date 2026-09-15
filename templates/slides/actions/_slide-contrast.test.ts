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

  it("measures a slide against the Tailwind utility canvas it names", async () => {
    // A named utility carries no CSS value in the markup, so the audit has to
    // resolve what it paints; inheriting over it would measure a canvas the
    // slide does not render on.
    expect(
      await slideContrastWarning({
        html: lightText,
        background: "bg-slate-900",
        designSystemId: "ds-light",
      }),
    ).toBeNull();

    const warning = await slideContrastWarning({
      html: lightText,
      background: "bg-white",
      designSystemId: "ds-dark",
    });
    expect(warning).toContain("unreadable as written");
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
