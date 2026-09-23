// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContentTableConstraintChip,
  ContentTableSearch,
  ContentTableSelectionControl,
  ContentTableSurface,
} from "./ContentTable";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { DatabaseTableGrid } from "./DatabaseTableGrid";

describe("shared Content table composition", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("owns the shared table frame, overflow contract, and frozen layout context", async () => {
    await act(async () =>
      root.render(
        <ContentTableSurface
          columnOrder={["name", "actor"]}
          frozenThroughColumnId="name"
          viewportWidth={500}
          rows={[{ id: "one" }]}
          columns={[
            { id: "name", width: 240 },
            { id: "actor", width: 180 },
          ]}
          columnWidths={{ name: 240, actor: 180 }}
          getRowId={(row) => row.id}
          renderHeader={() => (
            <DatabaseTableGrid
              className="grid"
              propertyIds={["actor"]}
              widths={{ name: 240, actor: 180 }}
              nameCell="Name"
              propertyCells={["Actor"]}
            />
          )}
          renderBody={() => <div>Row</div>}
        />,
      ),
    );

    expect(host.querySelector("[data-content-table-surface]")).not.toBeNull();
    const scroll = host.querySelector<HTMLElement>(
      "[data-data-grid-scroll-container]",
    );
    expect(scroll?.dataset.databaseScrollSurface).toBe("table");
    expect(scroll?.tabIndex).toBe(0);
    expect(scroll?.className).toContain("overflow-auto");
    expect(
      host.querySelector('[data-table-column="name"]')?.className,
    ).toContain("sticky");
  });

  it("shares search open, focus, typing, clear, and Escape behavior", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState("");
      return (
        <ContentTableSearch
          open={open}
          value={value}
          label="Search"
          placeholder="Search"
          closeLabel="Close search"
          onOpenChange={setOpen}
          onValueChange={setValue}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Search"]')?.click(),
    );
    const input = host.querySelector<HTMLInputElement>("input");
    expect(document.activeElement).toBe(input);
    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("needle");
    await act(async () =>
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(host.querySelector("input")).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Search"]'),
    ).not.toBeNull();
  });

  it("shares removable constraints and selection semantics", async () => {
    const remove = vi.fn();
    const toggle = vi.fn();
    await act(async () =>
      root.render(
        <>
          <ContentTableConstraintChip
            label="Type: Page"
            removeLabel="Remove Type: Page"
            onRemove={remove}
          />
          <ContentTableSelectionControl
            checked={false}
            indeterminate
            label="Select loaded"
            onToggle={toggle}
          />
        </>,
      ),
    );
    const selection = host.querySelector<HTMLElement>(
      '[aria-label="Select loaded"]',
    );
    expect(selection?.getAttribute("aria-checked")).toBe("mixed");
    await act(async () => selection?.click());
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Remove Type: Page"]')
        ?.click(),
    );
    expect(toggle).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});
