// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  DatabaseTableColumnOrder,
  DatabaseTableGrid,
  DatabaseTableLayout,
} from "./DatabaseTableGrid";

describe("table column DOM projection", () => {
  it("keeps the selection gutter fixed while visual tracks and DOM focus order follow column order", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    async function render(order: string[]) {
      await act(async () =>
        root.render(
          <DatabaseTableColumnOrder.Provider value={order}>
            <DatabaseTableLayout.Provider
              value={{ frozenThroughColumnId: undefined, viewportWidth: 900 }}
            >
              <DatabaseTableGrid
                className="grid"
                propertyIds={["text", "number"]}
                widths={{ name: 220, text: 180, number: 96 }}
                actionWidth={36}
                selectionCell={<button>Select</button>}
                nameCell={<button>Name</button>}
                propertyCells={[
                  <button key="text">Text</button>,
                  <button key="number">Number</button>,
                ]}
                actions={<button>Actions</button>}
              />
            </DatabaseTableLayout.Provider>
          </DatabaseTableColumnOrder.Provider>,
        ),
      );
    }
    try {
      await render(["number", "name", "text"]);
      expect(
        [...host.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
      ).toEqual(["Select", "Number", "Name", "Text", "Actions"]);
      expect(
        (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
      ).toBe("56px 96px 220px 180px 36px");
      expect(
        host.querySelector("[data-table-selection-gutter]")?.className,
      ).toContain("sticky");
      expect(
        host.querySelector("[data-table-selection-gutter]")?.className,
      ).toContain("flex");
      expect(
        host.querySelector("[data-table-selection-gutter]")?.className,
      ).toContain("justify-start");
      expect(
        host.querySelector<HTMLElement>('[data-table-column="number"]')?.style
          .left,
      ).toBe("56px");
      expect(
        host.querySelector('[data-table-column="name"]')?.className,
      ).not.toContain("sticky");
      await render(["text", "number", "name"]);
      expect(
        [...host.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
      ).toEqual(["Select", "Text", "Number", "Name", "Actions"]);
      expect(
        (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
      ).toBe("56px 180px 96px 220px 36px");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("uses cumulative offsets through the configured endpoint and no data freeze for null or a missing endpoint", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    async function render(frozenThroughColumnId: string | null) {
      await act(async () =>
        root.render(
          <DatabaseTableColumnOrder.Provider value={["number", "name", "text"]}>
            <DatabaseTableLayout.Provider
              value={{ frozenThroughColumnId, viewportWidth: 900 }}
            >
              <DatabaseTableGrid
                className="grid"
                propertyIds={["text", "number"]}
                widths={{ name: 220, text: 180, number: 96 }}
                nameCell="Name"
                propertyCells={["Text", "Number"]}
              />
            </DatabaseTableLayout.Provider>
          </DatabaseTableColumnOrder.Provider>,
        ),
      );
    }
    try {
      await render("text");
      expect(
        [...host.querySelectorAll<HTMLElement>("[data-table-frozen]")].map(
          (cell) => [cell.dataset.tableColumn, cell.style.left],
        ),
      ).toEqual([
        ["number", "56px"],
        ["name", "152px"],
        ["text", "372px"],
      ]);
      expect(
        host
          .querySelector("[data-table-freeze-boundary]")
          ?.getAttribute("data-table-column"),
      ).toBe("text");

      await render(null);
      expect(host.querySelectorAll("[data-table-frozen]")).toHaveLength(0);
      await render("hidden-property");
      expect(host.querySelectorAll("[data-table-frozen]")).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("caps the sticky prefix to preserve 120px of scrollable viewport", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    async function render(viewportWidth: number) {
      await act(async () =>
        root.render(
          <DatabaseTableColumnOrder.Provider value={["number", "name", "text"]}>
            <DatabaseTableLayout.Provider
              value={{ frozenThroughColumnId: "text", viewportWidth }}
            >
              <DatabaseTableGrid
                className="grid"
                propertyIds={["text", "number"]}
                widths={{ name: 220, text: 180, number: 96 }}
                gutterWidth={64}
                nameCell="Name"
                propertyCells={["Text", "Number"]}
              />
            </DatabaseTableLayout.Provider>
          </DatabaseTableColumnOrder.Provider>,
        ),
      );
    }
    try {
      await render(500);
      expect(
        [...host.querySelectorAll("[data-table-frozen]")].map((cell) =>
          cell.getAttribute("data-table-column"),
        ),
      ).toEqual(["number", "name"]);
      expect(
        (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
      ).toBe("64px 96px 220px 180px");

      await render(250);
      expect(host.querySelectorAll("[data-table-frozen]")).toHaveLength(0);

      await render(900);
      expect(host.querySelectorAll("[data-table-frozen]")).toHaveLength(3);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
