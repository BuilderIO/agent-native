// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  DatabaseTableColumnOrder,
  DatabaseTableGrid,
} from "./DatabaseTableGrid";

describe("table column DOM projection", () => {
  it("keeps visual tracks, DOM focus order and footer cells aligned when Name moves", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    async function render(order: string[]) {
      await act(async () =>
        root.render(
          <DatabaseTableColumnOrder.Provider value={order}>
            <DatabaseTableGrid
              className="grid"
              propertyIds={["text", "number"]}
              widths={{ name: 220, text: 180, number: 96 }}
              actionWidth={36}
              nameCell={<button>Name</button>}
              propertyCells={[
                <button key="text">Text</button>,
                <button key="number">Number</button>,
              ]}
              actions={<button>Actions</button>}
            />
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
      ).toEqual(["Number", "Name", "Text", "Actions"]);
      expect(
        (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
      ).toBe("96px 220px 180px 36px");
      expect(
        host.querySelector('[data-table-column="name"]')?.className,
      ).toContain("sticky");
      await render(["text", "number", "name"]);
      expect(
        [...host.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
      ).toEqual(["Text", "Number", "Name", "Actions"]);
      expect(
        (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
      ).toBe("180px 96px 220px 36px");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
