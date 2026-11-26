import { describe, expect, it } from "vitest";

import {
  DEFAULT_INSPECTOR_WIDTH,
  resolveInspectorWidth,
  snapInspectorDragWidth,
} from "./inspector-width";

describe("inspector width", () => {
  it("opens at 280 and holds stored widths between 280 and 400", () => {
    expect(DEFAULT_INSPECTOR_WIDTH).toBe(280);
    expect(resolveInspectorWidth(240)).toBe(280);
    expect(resolveInspectorWidth(100)).toBe(280);
    expect(resolveInspectorWidth(900)).toBe(400);
    expect(resolveInspectorWidth(390)).toBe(390);
  });

  it("snaps drags to 8px steps inside the limits", () => {
    expect(snapInspectorDragWidth(283)).toBe(280);
    expect(snapInspectorDragWidth(285)).toBe(288);
    expect(snapInspectorDragWidth(240)).toBe(280);
    expect(snapInspectorDragWidth(10)).toBe(280);
    expect(snapInspectorDragWidth(1000)).toBe(400);
  });
});
