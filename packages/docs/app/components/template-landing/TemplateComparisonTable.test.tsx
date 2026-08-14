// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TemplateComparisonTable } from "./TemplateComparisonTable";

afterEach(cleanup);

describe("TemplateComparisonTable", () => {
  it("renders a caption, scoped headers, overflow, and an emphasized column", () => {
    render(
      <TemplateComparisonTable
        caption="Product comparison"
        columns={[
          { id: "ours", header: "Our product", emphasized: true },
          { id: "theirs", header: "Alternative" },
        ]}
        rows={[
          {
            id: "ownership",
            label: "Data ownership",
            cells: { ours: "You", theirs: "Vendor" },
          },
        ]}
      />,
    );

    const caption = screen.getByText("Product comparison");
    const table = caption.closest("table");
    const productHeader = screen.getByRole("columnheader", {
      name: "Our product",
    });
    const rowHeader = screen.getByRole("rowheader", {
      name: "Data ownership",
    });

    expect(caption.tagName).toBe("CAPTION");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    expect(productHeader.getAttribute("scope")).toBe("col");
    expect(productHeader.getAttribute("data-emphasized")).toBe("true");
    expect(rowHeader.getAttribute("scope")).toBe("row");
    expect(
      screen.getByRole("cell", { name: "You" }).getAttribute("data-emphasized"),
    ).toBe("true");
  });
});
