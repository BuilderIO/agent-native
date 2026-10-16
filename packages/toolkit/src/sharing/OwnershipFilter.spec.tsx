// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterByOwnership,
  OwnershipFilter,
  type OwnershipFilterValue,
} from "./OwnershipFilter.js";

const labels = { all: "Todos", mine: "Míos", shared: "Compartidos" };

describe("filterByOwnership", () => {
  const rows = [
    { id: "a", mine: true },
    { id: "b", mine: false },
    { id: "c", mine: true },
  ];
  const isMine = (row: { mine: boolean }) => row.mine;

  it("keeps everything for all, without aliasing the input", () => {
    const result = filterByOwnership(rows, "all", isMine);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("splits owned and not-owned rows between mine and shared", () => {
    expect(filterByOwnership(rows, "mine", isMine).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
    expect(filterByOwnership(rows, "shared", isMine).map((r) => r.id)).toEqual([
      "b",
    ]);
  });
});

describe("OwnershipFilter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderFilter(
    value: OwnershipFilterValue,
    onChange: (value: OwnershipFilterValue) => void = () => {},
  ) {
    act(() =>
      root.render(
        <OwnershipFilter value={value} onChange={onChange} labels={labels} />,
      ),
    );
    return container.querySelector<HTMLButtonElement>("button")!;
  }

  it("names the trigger after the selected option and reserves room for the widest", () => {
    const trigger = renderFilter("mine");
    expect(trigger.getAttribute("aria-label")).toBe("Míos");
    const hidden = Array.from(
      trigger.querySelectorAll('[aria-hidden="true"].invisible'),
    ).map((node) => node.textContent);
    expect(hidden).toEqual(["Todos", "Míos", "Compartidos"]);
  });

  it("reports the chosen option from the menu and ignores unknown values", async () => {
    const onChange = vi.fn();
    const trigger = renderFilter("all", onChange);
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });

    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Todos",
      "Míos",
      "Compartidos",
    ]);
    expect(items[0]?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      items[2]?.click();
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("shared");
  });
});
