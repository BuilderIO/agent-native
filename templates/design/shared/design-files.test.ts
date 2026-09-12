import { describe, expect, it } from "vitest";

import { getOverviewScreenFileIds } from "./design-files";

describe("overview screen file classification", () => {
  it("matches the renderer's HTML-only overview and responsive occupancy", () => {
    const files = [
      { id: "screen", filename: "screen.html", fileType: "html" },
      { id: "legacy", filename: "legacy.html", fileType: null },
      { id: "jsx", filename: "component.jsx", fileType: "jsx" },
      { id: "board", filename: "__board__.html", fileType: "html" },
      { id: "styles", filename: "styles.css", fileType: "css" },
    ];

    expect(getOverviewScreenFileIds(files)).toEqual(["screen", "legacy"]);
  });
});
