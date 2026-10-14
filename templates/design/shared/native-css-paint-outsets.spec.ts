import { describe, expect, it } from "vitest";

import { readNativeCssPaintOutsets } from "./native-css-paint-outsets.js";

const base = {
  boxShadow: "none",
  outlineStyle: "none",
  outlineWidth: "0px",
  outlineOffset: "0px",
};

describe("readNativeCssPaintOutsets", () => {
  it("keeps layout bounds for no external paint and ignores inset shadows", () => {
    expect(readNativeCssPaintOutsets(base)).toEqual({
      kind: "ok",
      outsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(
      readNativeCssPaintOutsets({
        ...base,
        boxShadow: "rgb(0, 0, 0) 12px 0px 0px 0px inset",
      }),
    ).toEqual(readNativeCssPaintOutsets(base));
  });

  it("extends the positive offset edge beyond an overflow-visible child", () => {
    const result = readNativeCssPaintOutsets({
      ...base,
      boxShadow: "rgb(0, 0, 0) 12px 0px 0px 0px",
    });
    expect(result).toEqual({
      kind: "ok",
      outsets: { top: 2, right: 14, bottom: 2, left: 0 },
    });
    if (result.kind === "ok") {
      expect(208 + 142 + result.outsets.right).toBe(364);
    }
  });

  it("unions multiple shadows with directional blur and a visible outline", () => {
    expect(
      readNativeCssPaintOutsets({
        boxShadow:
          "rgba(0, 0, 0, 0.5) -4px 6px 8px 2px, rgb(0, 0, 0) 3px -2px 0px 0px inset",
        outlineStyle: "solid",
        outlineWidth: "3px",
        outlineOffset: "2px",
      }),
    ).toEqual({
      kind: "ok",
      outsets: { top: 10, right: 12, bottom: 22, left: 20 },
    });
  });

  it("keeps outer-shadow and outline capture bounds separate", () => {
    const style = {
      boxShadow: "rgb(0, 0, 0) 12px 0px 0px 0px",
      outlineStyle: "solid",
      outlineWidth: "3px",
      outlineOffset: "2px",
    };
    expect(readNativeCssPaintOutsets(style, "outer-shadow")).toEqual({
      kind: "ok",
      outsets: { top: 2, right: 14, bottom: 2, left: 0 },
    });
    expect(readNativeCssPaintOutsets(style, "outline")).toEqual({
      kind: "ok",
      outsets: { top: 5, right: 5, bottom: 5, left: 5 },
    });
  });

  it("accepts CSS Color 4 shadows and treats a hidden outline as unpainted", () => {
    expect(
      readNativeCssPaintOutsets({
        boxShadow: "color(display-p3 1 0.5 0) 12px 0px 0px 0px",
        outlineStyle: "hidden",
        outlineWidth: "8px",
        outlineOffset: "3px",
      }),
    ).toEqual({
      kind: "ok",
      outsets: { top: 2, right: 14, bottom: 2, left: 0 },
    });
    expect(
      readNativeCssPaintOutsets({
        ...base,
        boxShadow: "oklch(62% 0.15 250) -3px 2px 4px 0px",
      }),
    ).toEqual({
      kind: "ok",
      outsets: { top: 6, right: 5, bottom: 10, left: 11 },
    });
  });

  it("returns a typed unreadable result for missing or malformed computed paint", () => {
    expect(
      readNativeCssPaintOutsets({ ...base, boxShadow: undefined }),
    ).toEqual({ kind: "unreadable", property: "boxShadow" });
    expect(
      readNativeCssPaintOutsets({ ...base, boxShadow: "rgb(0, 0, 0) 3px" }),
    ).toEqual({ kind: "unreadable", property: "boxShadow" });
    expect(
      readNativeCssPaintOutsets({
        ...base,
        outlineStyle: "solid",
        outlineWidth: "medium",
      }),
    ).toEqual({ kind: "unreadable", property: "outlineWidth" });
    expect(
      readNativeCssPaintOutsets({ ...base, outlineStyle: "painted" }),
    ).toEqual({ kind: "unreadable", property: "outlineStyle" });
  });
});
