// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

const ROWS = vi.hoisted(() => [
  { name: "Ada", count: 3 },
  { name: "Grace", count: 5 },
]);

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({
    session: { email: "viewer@example.com", userId: "viewer", orgId: "org-1" },
    status: "authenticated",
  }),
  useActionMutation: () => ({ mutate: () => {}, isPending: false }),
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
    data: { rows: ROWS },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

vi.mock("@/pages/adhoc/sql-dashboard/ViewSqlPopover", () => ({
  ViewSqlPopover: () => null,
}));

import { SqlChartCard } from "@/pages/adhoc/sql-dashboard/SqlChartCard";

import { SqlChart } from "./SqlChart";

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
    localStorage.clear();
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

  async function doubleClick(target: Element) {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  async function renderCard(editable: boolean, onSaveColumns: () => void) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SqlChartCard
            panel={TABLE}
            dashboardId="d"
            editable={editable}
            eagerLoad
            onRemove={() => {}}
            onSaveColumns={onSaveColumns}
          />
        </TooltipProvider>,
      );
    });
  }

  async function dropColumn(fromKey: string, onto: HTMLElement) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { getData: () => fromKey },
    });
    await act(async () => {
      onto.dispatchEvent(event);
    });
  }

  async function openColumnMenu() {
    await act(async () => {
      nameHeader().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    return document.body.querySelector('[role="menu"]');
  }

  function nameLabel(): HTMLElement {
    const label = Array.from(nameHeader().querySelectorAll("span")).find(
      (span) => span.childElementCount === 0 && span.textContent === "name",
    );
    if (!label) throw new Error("column label not rendered");
    return label;
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

  it("lets a viewer size a dashboard table's columns but not rename, reorder, or format them", async () => {
    const onSaveColumns = vi.fn();
    await renderCard(false, onSaveColumns);

    expect(nameHeader().getAttribute("draggable")).toBe("false");
    await dropColumn("count", nameHeader());
    await doubleClick(nameLabel());
    expect(container.querySelector("th input")).toBeNull();
    expect(await openColumnMenu()).toBeNull();

    const [handle] = separators();
    expect(handle?.title).toBe("dashboardMode.columnResizePersonal");
    await drag(handle!, 200);
    expect(nameHeader().style.width).toBe("200px");
    await doubleClick(handle!);
    expect(nameHeader().style.width).toBe("90px");

    expect(onSaveColumns).not.toHaveBeenCalled();
  });

  it("keeps renaming, reordering, and the column menu in edit mode", async () => {
    const onSaveColumns = vi.fn();
    await renderCard(true, onSaveColumns);

    expect(nameHeader().getAttribute("draggable")).toBe("true");
    await dropColumn("count", nameHeader());
    expect(onSaveColumns).toHaveBeenLastCalledWith([
      { key: "count" },
      { key: "name", width: 90 },
    ]);

    await doubleClick(nameLabel());
    const input = container.querySelector<HTMLInputElement>("th input");
    expect(input).not.toBeNull();

    await act(async () => {
      input!.value = "Person";
      input!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onSaveColumns).toHaveBeenLastCalledWith([
      { key: "name", width: 90, label: "Person" },
      { key: "count" },
    ]);
    expect(await openColumnMenu()).not.toBeNull();
  });
});
