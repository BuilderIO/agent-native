import { describe, expect, it } from "vitest";

import { getPlanCodeAnnotationLayout } from "./PlanContentRenderer";

describe("getPlanCodeAnnotationLayout", () => {
  it("keeps plan code annotations hover-only by default", () => {
    const layout = getPlanCodeAnnotationLayout({
      isRecap: false,
      showCodeAnnotationOverlays: false,
    });

    expect(layout).toEqual({
      hoverSide: "left",
      hoverFallbackSide: "right",
      marginSide: "auto",
    });
    expect(layout).not.toHaveProperty("showByDefaultWhenRoom");
    expect(layout).not.toHaveProperty("defaultVisibleAnnotations");
  });

  it("keeps recap code annotations hover-only outside screenshot capture", () => {
    const layout = getPlanCodeAnnotationLayout({
      isRecap: true,
      showCodeAnnotationOverlays: false,
    });

    expect(layout).toEqual({
      hoverSide: "right",
      hoverFallbackSide: "right",
      marginSide: "auto",
    });
    expect(layout).not.toHaveProperty("showByDefaultWhenRoom");
    expect(layout).not.toHaveProperty("defaultVisibleAnnotations");
  });

  it("uses capture overlays only when screenshot mode requests them", () => {
    expect(
      getPlanCodeAnnotationLayout({
        isRecap: false,
        showCodeAnnotationOverlays: true,
      }),
    ).toBeUndefined();
  });
});
