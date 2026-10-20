import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ColumnPresentationMenuItems,
  databaseColumnWraps,
} from "./DatabaseColumnPresentation";

describe("database column presentation", () => {
  it("uses a column override ahead of the view-wide wrap default", () => {
    const presentation = {
      wrapCells: true,
      columnWrapOverrides: { title: false, notes: true },
    };

    expect(databaseColumnWraps(presentation, "title")).toBe(false);
    expect(databaseColumnWraps(presentation, "notes")).toBe(true);
    expect(databaseColumnWraps(presentation, "status")).toBe(true);
  });

  it("adds no menu chrome outside a database presentation context", () => {
    expect(
      renderToStaticMarkup(<ColumnPresentationMenuItems columnId="title" />),
    ).toBe("");
  });
});
