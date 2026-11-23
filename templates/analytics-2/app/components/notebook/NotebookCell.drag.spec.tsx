// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionQuery: () => ({
    data: { components: [] },
    isPending: false,
    error: null,
  }),
}));

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { CELL_DRAG_TYPE } from "./cell-drag";
import { NotebookCell } from "./NotebookCell";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function sqlCell(id: string): Cell {
  return {
    id,
    projectId: "project",
    versionId: "version",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    contents: {
      id,
      order: id,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "sql",
      source: "SELECT 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  };
}

function props(cell: Cell, extra: Record<string, unknown> = {}) {
  return {
    cell,
    title: `Cell ${cell.id}`,
    connections: [],
    canEdit: true,
    busy: false,
    running: false,
    saving: false,
    deleting: false,
    connectionPending: false,
    connectionId: null,
    draftText: "SELECT 1",
    dirty: false,
    stale: false,
    outputState: undefined,
    error: null,
    onTextChange: () => {},
    onSaveDraft: () => {},
    onRun: () => {},
    onDiscard: () => {},
    onOverwrite: () => {},
    onDelete: () => {},
    onSelectConnection: () => {},
    onDismissError: () => {},
    onRetryError: () => {},
    ...extra,
  };
}

function transfer(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get types() {
      return [...store.keys()];
    },
    effectAllowed: "all",
    dropEffect: "none",
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    setDragImage: () => {},
  };
}

function fire(
  node: Element,
  type: string,
  dataTransfer: ReturnType<typeof transfer>,
  clientY = 0,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  node.dispatchEvent(event);
  return event;
}

async function mount(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <NotebookCell {...props(sqlCell("a"), first)} />
        <NotebookCell {...props(sqlCell("b"), second)} />
      </AgentNativeI18nProvider>,
    ),
  );
  const cellOf = (id: string) => {
    const node = host.querySelector(`[data-notebook-cell="${id}"]`);
    assert(node);
    // jsdom has no layout: the cell spans 0 to 100.
    node.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    return node;
  };
  return {
    host,
    cellOf,
    gripOf: (id: string) => cellOf(id).querySelector("[draggable=true]"),
    unmount: () => act(async () => root.unmount()),
  };
}

it("drags a cell by its grip and drops it before or after another cell", async () => {
  const onDropCell = vi.fn();
  const view = await mount({ canDrag: true }, { onDropCell });
  const grip = view.gripOf("a");
  assert(grip);
  expect(grip.getAttribute("aria-label")).toBe(enUS.dashboards.panel.drag);

  const data = transfer();
  await act(async () => void fire(grip, "dragstart", data));
  expect(data.getData(CELL_DRAG_TYPE)).toBe("a");

  const target = view.cellOf("b");
  await act(async () => void fire(target, "dragenter", data, 80));
  const over = await act(async () => fire(target, "dragover", data, 80));
  expect(over.defaultPrevented).toBe(true);
  await act(async () => void fire(target, "drop", data, 80));
  expect(onDropCell).toHaveBeenCalledWith("a", "after");

  await act(async () => void fire(target, "dragover", data, 10));
  await act(async () => void fire(target, "drop", data, 10));
  expect(onDropCell).toHaveBeenLastCalledWith("a", "before");
  await view.unmount();
});

it("shows no grip and accepts no drop when the notebook cannot move cells", async () => {
  const view = await mount({}, {});
  expect(view.gripOf("a")).toBeNull();
  const data = transfer({ [CELL_DRAG_TYPE]: "a" });
  const over = await act(async () => fire(view.cellOf("b"), "dragover", data));
  expect(over.defaultPrevented).toBe(false);
  await view.unmount();
});

it("ignores text dragged out of an editor", async () => {
  const onDropCell = vi.fn();
  const view = await mount({}, { onDropCell });
  const data = transfer({ "text/plain": "SELECT 1" });
  const over = await act(async () => fire(view.cellOf("b"), "dragover", data));
  expect(over.defaultPrevented).toBe(false);
  await act(async () => void fire(view.cellOf("b"), "drop", data));
  expect(onDropCell).not.toHaveBeenCalled();
  await view.unmount();
});

it("keeps the grip in the left gutter and starts dragging only from it", async () => {
  const view = await mount({ canDrag: true }, {});
  const cell = view.cellOf("a");
  try {
    const grip = view.gripOf("a");
    assert(grip);
    expect(grip.closest(".nb-cell-gutter")).not.toBeNull();
    const frame = cell.querySelector(".nb-cell-frame");
    assert(frame);
    const data = transfer();
    await act(async () => void fire(frame, "dragstart", data));
    expect(data.getData(CELL_DRAG_TYPE)).toBe("");
    await act(async () => void fire(grip, "dragstart", data));
    expect(data.getData(CELL_DRAG_TYPE)).toBe("a");
  } finally {
    await view.unmount();
    view.host.remove();
  }
});
