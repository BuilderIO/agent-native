// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import { SqlChart } from "./SqlChart";

const ROWS = [
  { name: "Ada", count: 3 },
  { name: "Grace", count: 5 },
];

const TABLE: SqlPanel = {
  id: "p",
  title: "P",
  sql: "SELECT 1",
  source: "first-party",
  chartType: "table",
  width: 1,
  config: { columns: [{ key: "name", width: 90 }, { key: "count" }] },
};

describe("SqlChart table column widths", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    HTMLElement.prototype.setPointerCapture = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function separators(): HTMLElement[] {
    return Array.from(container.querySelectorAll('[role="separator"]'));
  }

  function nameHeader(): HTMLElement {
    const header = container.querySelector("th");
    if (!header) throw new Error("table header not rendered");
    return header;
  }

  async function drag(handle: HTMLElement, toX: number) {
    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0 }),
      );
    });
    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: toX }),
      );
    });
  }

  it("offers no resize handle on a read-only table", async () => {
    await act(async () => {
      root.render(<SqlChart panel={TABLE} resultOverride={{ rows: ROWS }} />);
    });
    expect(separators()).toHaveLength(0);
  });

  it("sends a viewer's drag to the personal handler, never the saved columns", async () => {
    const onColumnWidthChange = vi.fn();
    await act(async () => {
      root.render(
        <SqlChart
          panel={TABLE}
          resultOverride={{ rows: ROWS }}
          onColumnWidthChange={onColumnWidthChange}
        />,
      );
    });
    const [handle] = separators();
    expect(handle?.title).toBe("dashboardMode.columnResizePersonal");

    await drag(handle!, 200);
    expect(onColumnWidthChange).toHaveBeenCalledWith("name", 200);

    await act(async () => {
      handle!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onColumnWidthChange).toHaveBeenLastCalledWith("name", null);
  });

  it("saves an editor's drag into the panel's columns", async () => {
    const onSaveColumns = vi.fn();
    await act(async () => {
      root.render(
        <SqlChart
          panel={TABLE}
          resultOverride={{ rows: ROWS }}
          onSaveColumns={onSaveColumns}
        />,
      );
    });
    const [handle] = separators();
    expect(handle?.title).toBe("dashboardMode.columnResizeShared");

    await drag(handle!, 200);
    expect(onSaveColumns).toHaveBeenCalledWith([
      { key: "name", width: 200 },
      { key: "count" },
    ]);
  });

  it("draws a viewer's own width over the saved one", async () => {
    await act(async () => {
      root.render(
        <SqlChart
          panel={TABLE}
          resultOverride={{ rows: ROWS }}
          columnWidths={{ name: 260 }}
          onColumnWidthChange={() => {}}
        />,
      );
    });
    expect(nameHeader().style.width).toBe("260px");
  });
});
