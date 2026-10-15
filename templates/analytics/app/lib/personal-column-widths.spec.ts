// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TableColumnConfig } from "@/pages/adhoc/sql-dashboard/types";

import {
  activePersonalColumnWidths,
  parsePersonalColumnWidths,
  personalColumnWidthsKey,
  usePersonalColumnWidths,
} from "./personal-column-widths";

describe("parsePersonalColumnWidths", () => {
  it("reads nothing from an absent or corrupt value", () => {
    expect(parsePersonalColumnWidths(null)).toEqual({});
    expect(parsePersonalColumnWidths("{not json")).toEqual({});
    expect(parsePersonalColumnWidths("[1,2]")).toEqual({});
  });

  it("keeps well-formed entries and drops the rest", () => {
    const raw = JSON.stringify({
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
      bad: { width: -5, base: null },
      missingBase: { width: 100 },
    });
    expect(parsePersonalColumnWidths(raw)).toEqual({
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    });
  });
});

describe("activePersonalColumnWidths", () => {
  it("applies a width while the dashboard's own width is unchanged", () => {
    const stored = {
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    };
    expect(
      activePersonalColumnWidths(stored, [
        { key: "name" },
        { key: "count", width: 90 },
      ]),
    ).toEqual({ name: 240, count: 120 });
  });

  it("drops a width once the dashboard's own width changes", () => {
    const stored = {
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    };
    expect(
      activePersonalColumnWidths(stored, [
        { key: "name", width: 300 },
        { key: "count", width: 150 },
      ]),
    ).toEqual({});
  });

  it("applies a width for a column the panel has no config for", () => {
    expect(
      activePersonalColumnWidths(
        { name: { width: 240, base: null } },
        undefined,
      ),
    ).toEqual({ name: 240 });
  });
});

describe("usePersonalColumnWidths", () => {
  const storageKey = personalColumnWidthsKey("dash-1", "panel-1");
  let container: HTMLDivElement;
  let root: Root;
  let widths: Record<string, number> = {};

  function Harness({ columns }: { columns: TableColumnConfig[] }) {
    widths = usePersonalColumnWidths("dash-1", "panel-1", columns).widths;
    return null;
  }

  async function renderColumns(columns: TableColumnConfig[]) {
    await act(async () => {
      root.render(createElement(Harness, { columns }));
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    widths = {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  it("forgets a width once the shared width changes, even if it changes back", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        name: { width: 240, base: null },
        count: { width: 120, base: 90 },
      }),
    );

    await renderColumns([{ key: "name" }, { key: "count", width: 90 }]);
    expect(widths).toEqual({ name: 240, count: 120 });

    await renderColumns([{ key: "name" }, { key: "count", width: 150 }]);
    await renderColumns([{ key: "name" }, { key: "count", width: 90 }]);

    expect(widths).toEqual({ name: 240 });
    expect(
      parsePersonalColumnWidths(window.localStorage.getItem(storageKey)),
    ).toEqual({ name: { width: 240, base: null } });
  });

  it("forgets a width once an editor sets the shared width and then resets it", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ name: { width: 240, base: null } }),
    );

    await renderColumns([{ key: "name" }]);
    expect(widths).toEqual({ name: 240 });

    await renderColumns([{ key: "name", width: 300 }]);
    await renderColumns([{ key: "name" }]);

    expect(widths).toEqual({});
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });
});
