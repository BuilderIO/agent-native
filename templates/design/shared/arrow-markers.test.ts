import { describe, expect, it } from "vitest";

import {
  ARROW_MARKER_TYPES,
  arrowMarkerDefinitionsHtml,
  arrowMarkerUrl,
  arrowMarkerTypesForPrimitive,
  markerTypeFromStyleValue,
} from "./arrow-markers";

describe("arrow marker vocabulary", () => {
  it("matches the Figma endpoint menu and preserves primitive defaults", () => {
    expect(ARROW_MARKER_TYPES).toEqual([
      "none",
      "round",
      "square",
      "line-arrow",
      "triangle-arrow",
      "reversed-triangle",
      "circle-arrow",
      "diamond-arrow",
    ]);
    expect(arrowMarkerTypesForPrimitive("line")).toEqual({
      start: "none",
      end: "none",
    });
    expect(arrowMarkerTypesForPrimitive("arrow")).toEqual({
      start: "none",
      end: "line-arrow",
    });
  });

  it("keeps the historical default arrow id while giving other markers stable ids", () => {
    expect(arrowMarkerUrl("arrow-1", "line-arrow")).toBe("url(#arrow-1-arrow)");
    expect(arrowMarkerUrl("arrow-1", "round")).toBe(
      "url(#arrow-1-marker-round)",
    );
    expect(arrowMarkerUrl("arrow-1", "none")).toBeUndefined();
  });

  it("normalizes optimistic URL styles back to inspector marker values", () => {
    expect(
      markerTypeFromStyleValue("arrow-1", "url(#arrow-1-marker-round)", "none"),
    ).toBe("round");
    expect(
      markerTypeFromStyleValue("arrow-1", 'url("#arrow-1-arrow")', "none"),
    ).toBe("line-arrow");
    expect(
      markerTypeFromStyleValue("arrow-1", "url(#other-marker)", "none"),
    ).toBe("none");
  });

  it("serializes all endpoint definitions once so swapping is source-safe", () => {
    const defs = arrowMarkerDefinitionsHtml("line-1", "#2563eb");
    expect(defs.match(/<marker\b/g)).toHaveLength(7);
    expect(defs).toContain('id="line-1-arrow"');
    expect(defs).toContain('id="line-1-marker-diamond-arrow"');
    expect(defs).toContain('stroke="#2563eb"');
  });
});
