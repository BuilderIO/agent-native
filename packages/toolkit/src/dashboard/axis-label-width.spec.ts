import { describe, expect, it } from "vitest";

import { fitAxisLabelToWidth } from "./axis-label-width.js";

describe("axis label pixel limits", () => {
  it("shortens labels at the measured width without changing source rows", () => {
    const rows = [
      { category: "Northwest Enterprise Retention Segment", value: 1 },
      { category: "Month-to-date Expansion Opportunities", value: 2 },
      { category: "Strategic Accounts with Renewal Risk", value: 3 },
    ];
    const sourceRows = structuredClone(rows);
    const measureText = (text: string) => Array.from(text).length * 8;
    const visibleLabels = rows.map((row) =>
      fitAxisLabelToWidth(row.category, 72, measureText),
    );

    expect(visibleLabels.every((label) => label.endsWith("…"))).toBe(true);
    expect(visibleLabels.every((label) => measureText(label) <= 72)).toBe(true);
    expect(rows).toEqual(sourceRows);
    expect(rows.map((row) => row.value)).toEqual([1, 2, 3]);
  });
});
