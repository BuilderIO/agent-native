// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellSchema, cellOutputSchema, type Cell } from "@/lib/model/contracts";

import { fillAppLayoutGap } from "../../../e2e/phase1/mounted-gestures";
import {
  applyAppPatches,
  appDocumentSchema,
  emptyAppLayout,
  legacyAppLayout,
  projectAppLayout,
  type AppPatch,
} from "../../../shared/app-layout";
import {
  notebookCellIdSchema,
  revisionSchema,
} from "../../../shared/notebook-snapshot-contract";
import { appBuilderCellKindSchema, appCellDraft } from "./app-cell-draft";
import { ProjectAppBuilder } from "./ProjectAppBuilder";

import notebookStyles from "./notebook.css?raw";

const cell = {
  id: "cell_1",
  projectId: "project_1",
  versionId: "working",
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  contents: {
    id: "cell_1",
    order: "a1",
    kind: "text",
    text: "Notes",
    label: "Notes",
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
  },
} as Cell;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function initialLayout(cells: readonly Cell[]) {
  return applyAppPatches(
    emptyAppLayout(revisionSchema.parse("0")),
    [{ type: "initialize" }],
    cells,
  );
}

type BuilderProps = ComponentProps<typeof ProjectAppBuilder>;

function mountBuilder(props: BuilderProps) {
  root.render(
    <TooltipProvider>
      <ProjectAppBuilder {...props} />
    </TooltipProvider>,
  );
}

async function renderBuilder(
  props: Omit<BuilderProps, "layout"> & { layout?: BuilderProps["layout"] },
) {
  await act(async () =>
    mountBuilder({
      ...props,
      layout: props.layout ?? initialLayout(props.cells),
    }),
  );
}

function tabBuilderFixture(startingPatches: AppPatch[] = []) {
  const cells = [cell];
  let saved = JSON.stringify(
    applyAppPatches(initialLayout(cells), startingPatches, cells),
  );
  const readLayout = () => appDocumentSchema.parse(JSON.parse(saved));
  const onChangeLayout = vi.fn(async (patches: readonly AppPatch[]) => {
    saved = JSON.stringify(applyAppPatches(readLayout(), patches, cells));
    const layout = readLayout();
    mountBuilder({ ...props, layout });
    return layout;
  });
  const props = { cells, outputs: {}, canEdit: true, onChangeLayout };
  return { props, readLayout };
}

function buttonNamed(name: string | RegExp) {
  const button = [...document.querySelectorAll("button")].find((item) => {
    const label = item.getAttribute("aria-label") ?? item.textContent;
    return typeof name === "string" ? label === name : name.test(label);
  });
  assert(button, `Missing button ${name}`);
  return button;
}

function inputNamed(name: string) {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  );
  assert(input, `Missing input ${name}`);
  return input;
}

async function tabMenuAction(name: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-selected="true"]',
  );
  assert(trigger);
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((entry) => entry.textContent === name);
  assert(item, `Missing tab action ${name}`);
  await act(async () => item.click());
}

it("opens tab actions only when clicking the selected tab", async () => {
  const { props, readLayout } = tabBuilderFixture([
    { type: "tab-add", tabId: "details", name: "Details", afterTabId: "tab-1" },
  ]);
  await renderBuilder({ ...props, layout: readLayout() });
  const details = buttonNamed("Details");

  async function clickDetails() {
    await act(async () => {
      const sendMouseDown = details.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      if (sendMouseDown) {
        details.dispatchEvent(
          new MouseEvent("mousedown", { button: 0, bubbles: true }),
        );
      }
      details.click();
    });
  }

  await clickDetails();
  expect(details.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector('[role="menu"]')).toBeNull();

  await clickDetails();
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    ),
  ).toEqual(["Rename tab", "Duplicate tab", "Delete tab"]);
  expect(details.id).toBe(
    container
      .querySelector('[role="tabpanel"]')
      ?.getAttribute("aria-labelledby"),
  );
  expect(
    container.querySelector('button[aria-label="Tab settings"]'),
  ).toBeNull();
});

it("keeps first-tab placements, selects the new name and persists a rename on blur", async () => {
  const { props, readLayout } = tabBuilderFixture();
  const originalRows = readLayout().tabs[0]?.rows;
  await renderBuilder({ ...props, layout: readLayout() });
  expect(container.querySelector('[role="tablist"]')).toBeNull();

  await act(async () => buttonNamed(/^(\+ )?Add tab$/).click());
  expect(readLayout().tabs.map(({ name }) => name)).toEqual(["Tab 1", "Tab 2"]);
  expect(readLayout().tabs[0]?.rows).toEqual(originalRows);
  expect(readLayout().tabs[1]?.rows).toEqual([]);
  const activeName = () =>
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  expect(activeName()).toBe("Tab 1");
  const name = inputNamed("Tab name");
  expect(document.activeElement).toBe(name);
  expect([name.selectionStart, name.selectionEnd]).toEqual([0, 5]);

  await act(async () => {
    name.value = "Details";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.blur();
  });
  const renamed = readLayout();
  expect(renamed.tabs.map(({ name }) => name)).toEqual(["Tab 1", "Details"]);
  expect(activeName()).toBe("Tab 1");

  await act(async () => root.unmount());
  root = createRoot(container);
  await renderBuilder({ ...props, layout: renamed });
  expect(
    [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    ),
  ).toEqual(["Tab 1", "Details"]);
});

it("duplicates a tab in one patch and confirms deletion without removing notebook cells", async () => {
  const { props, readLayout } = tabBuilderFixture([
    { type: "tab-add", tabId: "details", name: "Details", afterTabId: "tab-1" },
  ]);
  await renderBuilder({ ...props, layout: readLayout() });

  await tabMenuAction("Duplicate tab");
  await vi.waitFor(() => {
    const activeTab = container.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect(activeTab?.textContent).toBe("Tab 1 (Copy)");
    expect(document.activeElement).toBe(activeTab);
  });
  expect(props.onChangeLayout).toHaveBeenCalledTimes(1);
  expect(props.onChangeLayout.mock.calls[0]?.[0]).toHaveLength(1);
  const [source, copy] = readLayout().tabs;
  expect(readLayout().tabs.map(({ name }) => name)).toEqual([
    "Tab 1",
    "Tab 1 (Copy)",
    "Details",
  ]);
  const originalRow = source?.rows[0];
  const copiedRow = copy?.rows[0];
  assert(originalRow);
  assert(copiedRow);
  expect(copiedRow.rowId).not.toBe(originalRow.rowId);
  const originalColumn = originalRow.columns[0];
  const copiedColumn = copiedRow.columns[0];
  assert(originalColumn);
  assert(copiedColumn);
  expect(copiedColumn.columnId).not.toBe(originalColumn.columnId);
  const originalElement = originalColumn.elements[0];
  const copiedElement = copiedColumn.elements[0];
  assert(originalElement);
  assert(copiedElement);
  expect(copiedElement.elementId).not.toBe(originalElement.elementId);
  expect(copiedElement).toEqual({
    ...originalElement,
    elementId: copiedElement.elementId,
  });

  const sourceTab = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((tab) => tab.textContent === "Tab 1");
  assert(sourceTab);
  await act(async () => sourceTab.focus());
  expect(sourceTab.getAttribute("aria-selected")).toBe("true");
  await tabMenuAction("Delete tab");
  const confirmation = document.querySelector(
    '[role="alertdialog"], [role="dialog"]',
  );
  expect(confirmation?.textContent).toContain(
    "Are you sure you want to delete Tab 1? This tab currently contains 1 cell.",
  );
  expect(confirmation?.textContent).toContain(
    "Deleting this tab will not delete cells from your notebook.",
  );
  expect(readLayout().tabs[0]?.name).toBe("Tab 1");
  await act(async () => buttonNamed("Delete tab").click());
  expect(readLayout().tabs.map(({ name }) => name)).toEqual([
    "Tab 1 (Copy)",
    "Details",
  ]);
  expect(readLayout().tabs[0]?.rows[0]?.columns[0]?.elements).toEqual([
    copiedElement,
  ]);
  expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
    "Notes",
  );
});

it("shows editable App settings with release defaults and saves through the layout patch", async () => {
  const cells = [cell];
  let layout = initialLayout(cells);
  const onChangeLayout = vi.fn(async (patches: readonly AppPatch[]) => {
    layout = applyAppPatches(layout, patches, cells);
    mountBuilder({ ...props, layout });
    return layout;
  });
  const props = { cells, outputs: {}, canEdit: true, onChangeLayout };
  await renderBuilder({ ...props, layout });
  const trigger = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "App settings",
  );
  assert(trigger);
  await act(async () => trigger.click());
  const dialog = document.querySelector(
    '[role="dialog"][aria-label="App settings"]',
  );
  assert(dialog);
  const checkboxes = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
  );
  expect(
    checkboxes.map((checkbox) => [
      checkbox.closest("label")?.textContent,
      checkbox.getAttribute("aria-checked"),
    ]),
  ).toEqual([
    ["Full width", "false"],
    ["Table of contents", "true"],
    ["Metadata", "true"],
    ["Run from scratch on load", "false"],
    ["Auto-refresh published results", "true"],
    ["Auto-rerun cells", "true"],
  ]);
  expect(dialog.querySelector("details")).toBeNull();
  expect(dialog.querySelector("[data-app-stale-after]")?.textContent).toContain(
    "Mark app results as stale if older than 24 hours",
  );
  expect(
    dialog.querySelector(
      'section[aria-label="Tabs"] button[aria-label="Organize your published app with multiple tabs."]',
    ),
  ).not.toBeNull();
  expect(dialog.textContent).toContain(
    "Automatically refresh published results when a user runs the app, or when results are stale.",
  );
  const headings = Array.from(
    dialog.querySelectorAll("legend, h3"),
    (node) => node.textContent,
  );
  expect(headings).toEqual(["Display options", "Tabs", "App run settings"]);
  const fullWidth = checkboxes[0];
  assert(fullWidth);
  await act(async () => fullWidth.click());
  expect(onChangeLayout).toHaveBeenCalledWith([
    { type: "settings", key: "fullWidth", value: true },
  ]);
  expect(layout.settings.fullWidth).toBe(true);
  expect(
    container
      .querySelector(".nb-app-builder-canvas")
      ?.getAttribute("data-full-width"),
  ).toBe("true");
});

it("restores tab focus after cancelling or saving a name with the keyboard", async () => {
  const { props, readLayout } = tabBuilderFixture();
  await act(async () =>
    props.onChangeLayout([
      { type: "tab-add", tabId: "details", name: "Details" },
    ]),
  );

  async function editName(value: string, key: "Enter" | "Escape") {
    await tabMenuAction("Rename tab");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(inputNamed("Tab name")),
    );
    const name = inputNamed("Tab name");
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 5]);
    await act(async () => {
      name.value = value;
      name.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    expect(document.activeElement).toBe(
      container.querySelector('[role="tab"][aria-selected="true"]'),
    );
  }

  await editName("Ignored", "Escape");
  expect(readLayout().tabs[0]?.name).toBe("Tab 1");
  await editName("Overview", "Enter");
  expect(readLayout().tabs[0]?.name).toBe("Overview");
});

it("explains a duplicate tab name instead of showing the generic save error", async () => {
  const { props, readLayout } = tabBuilderFixture();
  await act(async () =>
    props.onChangeLayout([
      { type: "tab-add", tabId: "details", name: "Details" },
    ]),
  );
  props.onChangeLayout.mockClear();
  await tabMenuAction("Rename tab");
  const name = inputNamed("Tab name");
  await act(async () => {
    name.value = "details";
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(props.onChangeLayout).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Another tab already uses that name.",
  );
  expect(document.activeElement).toBe(inputNamed("Tab name"));
  expect(readLayout().tabs.map((item) => item.name)).toEqual([
    "Tab 1",
    "Details",
  ]);
});

it("rolls back a rejected settings reorder and saves on keyboard retry", async () => {
  const { props, readLayout } = tabBuilderFixture();
  const notify = vi.spyOn(toast, "error").mockImplementation(() => "reorder");
  await act(async () =>
    props.onChangeLayout([
      { type: "tab-add", tabId: "details", name: "Details" },
    ]),
  );
  props.onChangeLayout.mockClear();
  props.onChangeLayout.mockRejectedValueOnce(
    new Error("Layout revision changed"),
  );
  await act(async () => buttonNamed("App settings").click());

  const tabList = document.querySelector('[aria-label="App settings"] ul');
  assert(tabList);
  const rows = () =>
    [...tabList.querySelectorAll("li")].map((row) =>
      [...row.querySelectorAll("span")].map((text) => text.textContent),
    );
  const first = ["Tab 1", "1 element"];
  const second = ["Details", "0 elements"];
  expect(rows()).toEqual([first, second]);

  async function moveFirstTabDown() {
    await act(async () => {
      const handle = buttonNamed("Reorder Tab 1");
      handle.focus();
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
  }

  await moveFirstTabDown();
  expect(rows()).toEqual([first, second]);
  expect(readLayout().tabs.map(({ name }) => name)).toEqual([
    "Tab 1",
    "Details",
  ]);
  expect(notify).toHaveBeenCalledExactlyOnceWith(
    "Failed to reorder tabs. Please refresh the page and try again.",
  );

  await moveFirstTabDown();
  expect(props.onChangeLayout.mock.calls.map(([patches]) => patches)).toEqual([
    [{ type: "tab-move", tabId: "tab-1", afterTabId: "details" }],
    [{ type: "tab-move", tabId: "tab-1", afterTabId: "details" }],
  ]);
  expect(rows()).toEqual([second, first]);
  expect(readLayout().tabs.map(({ name }) => name)).toEqual([
    "Details",
    "Tab 1",
  ]);
  expect(notify).toHaveBeenCalledTimes(1);
  notify.mockRestore();
});

it("preserves collision-resolved legacy intervals in the builder projection", async () => {
  const cells = [
    cell,
    cellSchema.parse({
      ...cell,
      id: "right",
      contents: { ...cell.contents, id: "right", label: "Right tile" },
    }),
    cellSchema.parse({
      ...cell,
      id: "below",
      contents: {
        ...cell.contents,
        id: "below",
        label: "Lower tile",
        gridX: 0,
        gridY: 1,
        gridWidth: 12,
      },
    }),
  ];
  const layout = legacyAppLayout(cells, revisionSchema.parse("0"));
  await renderBuilder({ cells, outputs: {}, canEdit: false, layout });
  const rows = [...container.querySelectorAll(".nb-app-builder-row")];
  expect(
    rows.map((row) =>
      [...row.querySelectorAll<HTMLElement>(".nb-app-builder-column")].map(
        (column) => column.style.getPropertyValue("--app-placement"),
      ),
    ),
  ).toEqual([["1 / span 60", "61 / span 60"], ["1 / span 120"]]);
  expect(rows.map((row) => row.textContent)).toEqual([
    "NotesNotesRight tileNotes",
    "Lower tileNotes",
  ]);
});

it("joins rows by pointer and resizes by pointer and keyboard on a 390px canvas", async () => {
  const right = cellSchema.parse({
    ...cell,
    id: "right",
    contents: { ...cell.contents, id: "right", label: "Right tile" },
  });
  const cells = [cell, right];
  let layout = initialLayout(cells);
  const onChangeLayout = vi.fn(async (patches: readonly AppPatch[]) => {
    layout = applyAppPatches(layout, patches, cells);
    mountBuilder({ ...props, layout });
    return layout;
  });
  const props = { cells, outputs: {}, canEdit: true, onChangeLayout };
  await renderBuilder({ ...props, layout });

  function setPhoneBounds() {
    const rows = [...container.querySelectorAll<HTMLElement>("[data-app-row]")];
    rows.forEach((row, index) => {
      const top = index * 220;
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, top, 390, 220),
      );
    });
  }

  async function pointerGesture(
    label: string,
    button: HTMLButtonElement,
    coordinates: [number, number][],
  ) {
    expect(button.getAttribute("aria-label")).toBe(label);
    await act(async () => {
      for (const [index, [clientX, clientY]] of coordinates.entries()) {
        button.dispatchEvent(
          new PointerEvent(
            index === 0
              ? "pointerdown"
              : index === 1
                ? "pointermove"
                : "pointerup",
            {
              button: 0,
              pointerId: 1,
              pointerType: "touch",
              bubbles: true,
              clientX,
              clientY,
            },
          ),
        );
      }
    });
  }

  const control = (label: string, title = "Notes") => {
    const button = container.querySelector<HTMLButtonElement>(
      `section[aria-label="${title}"] button[aria-label="${label}"]`,
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (!button) throw new Error("Missing layout control");
    return button;
  };
  const intervals = () =>
    projectAppLayout(layout).rows.map(({ columns }) =>
      columns.map(({ left, right }) => [left, right]),
    );

  setPhoneBounds();
  await pointerGesture(
    "Hold to drag element",
    control("Hold to drag element"),
    [
      [35, 65],
      [60, 250],
      [60, 250],
    ],
  );
  expect(intervals()).toEqual([
    [
      [0, 60],
      [60, 120],
    ],
  ]);

  setPhoneBounds();
  await pointerGesture(
    "Increase width",
    control("Increase width", "Right tile"),
    [
      [195, 65],
      [211.25, 65],
      [211.25, 65],
    ],
  );
  expect(intervals()).toEqual([
    [
      [0, 65],
      [65, 120],
    ],
  ]);

  await act(async () => {
    const keyboardResize = control("Increase width", "Right tile");
    keyboardResize.focus();
    keyboardResize.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
  });
  expect(intervals()).toEqual([
    [
      [0, 60],
      [65, 120],
    ],
  ]);
  expect(onChangeLayout.mock.calls).toHaveLength(3);
  expect(container.querySelector('[role="status"]')?.textContent).toMatch(
    /Row 1, columns/,
  );

  function press(button: HTMLElement, key: string) {
    return act(async () => {
      button.focus();
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  await fillAppLayoutGap(
    { click: () => press(control("Layout for Notes"), "Enter") },
    {
      click: async () => {
        const move = [
          ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ].find((item) => item.textContent === "Move left");
        assert(move);
        await act(async () => move.click());
      },
    },
    {
      click: async () => {
        expect(control("Increase width").disabled).toBe(false);
      },
      press: (key) => press(control("Increase width"), key),
    },
    1,
  );
  expect(intervals()).toEqual([
    [
      [0, 60],
      [60, 120],
    ],
  ]);
});

it.each(["text", "markdown"] as const)(
  "renders %s tiles as Markdown with their notebook titles",
  async (kind) => {
    const markdown = cellSchema.parse({
      ...cell,
      contents: {
        ...cell.contents,
        kind,
        label: null,
        [kind]: "# Revenue overview\n\nSee **monthly** results.",
      },
    });
    await renderBuilder({
      cells: [markdown],
      outputs: {},
      canEdit: false,
    });

    expect
      .soft(container.querySelector("h2")?.textContent)
      .toBe(kind === "text" ? "Text 1" : "Markdown 1");
    expect(
      container.querySelector('[role="heading"][aria-level="1"]')?.textContent,
    ).toBe("Revenue overview");
    expect(container.querySelector("strong")?.textContent).toBe("monthly");
  },
);

it("keeps a narrow tile's heading on one line and allows its controls to wrap", async () => {
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  try {
    await renderBuilder({
      cells: [
        cellSchema.parse({
          ...cell,
          contents: { ...cell.contents, label: "Chart 1", gridWidth: 3 },
        }),
      ],
      outputs: {},
      canEdit: true,
      onChangeLayout: vi.fn(),
    });
    const heading = container.querySelector("h2");
    const header = heading?.closest("header");
    const controls = header?.querySelector('[aria-label="Layout for Chart 1"]');
    expect(heading?.textContent).toBe("Chart 1");
    expect.soft(heading && getComputedStyle(heading).whiteSpace).toBe("nowrap");
    expect.soft(header && getComputedStyle(header).flexWrap).toBe("wrap");
    expect(controls && getComputedStyle(controls).flexWrap).toBe("wrap");
  } finally {
    style.remove();
  }
});

it("keeps every tile layout control focusable and explains its action on keyboard focus", async () => {
  await renderBuilder({
    cells: [cell],
    outputs: {},
    canEdit: true,
    onChangeLayout: vi.fn(),
  });
  const controls = container.querySelector(
    'header [role="group"][aria-label="Layout for Notes"]',
  );
  assert(controls);
  const buttons = [...controls.querySelectorAll("button")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Hold to drag element",
    "Increase width",
    "Increase height",
    "Layout for Notes",
  ]);
  for (const button of buttons) {
    const matches = button.matches.bind(button);
    const focusVisible = vi
      .spyOn(button, "matches")
      .mockImplementation(
        (selector) => selector === ":focus-visible" || matches(selector),
      );
    await act(async () => button.focus());
    expect(document.activeElement).toBe(button);
    expect(button.tabIndex).toBe(0);
    const description = button.getAttribute("aria-describedby");
    assert(description);
    const tip = document.getElementById(description);
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(tip?.textContent).toBe(button.getAttribute("aria-label"));
    focusVisible.mockRestore();
    await act(async () => button.blur());
  }
});

it("previews an input using its saved default first", async () => {
  const input = cellSchema.parse({
    ...cell,
    contents: {
      ...cell.contents,
      kind: "input",
      label: "Include archived rows",
      name: "include_archived",
      inputType: "CHECKBOX",
      defaultValueString: "true",
    },
  });
  const onChangeLayout = vi.fn();
  await renderBuilder({
    cells: [input],
    outputs: {},
    canEdit: true,
    onChangeLayout,
  });

  expect(container.querySelector("h2")?.textContent).toBe("include_archived");
  const toggle = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Include archived rows"]',
  );
  expect(toggle?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle?.click());
  expect(toggle?.getAttribute("aria-checked")).toBe("false");
  expect(onChangeLayout).not.toHaveBeenCalled();
});

it("draws bound and inline charts without editing controls or chart-owned outputs", async () => {
  const source = cellSchema.parse({
    ...cell,
    id: "source",
    contents: {
      ...cell.contents,
      id: "source",
      kind: "sql",
      source: "select amount, target, source from flows",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: "flows",
      outputResult: true,
    },
  });
  const sankey = cellSchema.parse({
    ...cell,
    id: "sankey",
    contents: {
      ...cell.contents,
      id: "sankey",
      kind: "chart",
      dataframe: "flows",
      chartSpec: {
        mark: "sankey",
        xField: "source",
        yField: "amount",
        seriesField: "target",
        title: "App flow",
      },
    },
  });
  const inline = cellSchema.parse({
    ...cell,
    id: "inline",
    contents: {
      ...cell.contents,
      id: "inline",
      kind: "chart",
      dataframe: JSON.stringify([
        { region: "North", amount: 12 },
        { region: "South", amount: 24 },
      ]),
      chartSpec: {
        mark: "bar",
        xField: "region",
        yField: "amount",
        seriesField: null,
        title: "App amounts",
      },
    },
  });
  const unknown = cellSchema.parse({
    ...inline,
    id: "unknown",
    contents: {
      ...inline.contents,
      id: "unknown",
      dataframe: "unavailable-result",
    },
  });
  await renderBuilder({
    cells: [source, sankey, inline, unknown],
    outputs: {
      source: {
        output: cellOutputSchema.parse({
          type: "table",
          columns: [
            { name: "amount", type: "number" },
            { name: "target", type: "string" },
            { name: "source", type: "string" },
          ],
          rows: [
            [42, "B", "A"],
            [84, "C", "A"],
          ],
          rowCount: 2,
          truncated: false,
        }),
      },
    },
    canEdit: false,
  });
  expect(
    [...container.querySelectorAll(".nb-chart-sankey-link title")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["A → B: 42", "A → C: 84"]);
  await vi.waitFor(
    () =>
      expect(
        container.querySelectorAll(".nb-chart-mark-bar g.mark-rect path"),
      ).toHaveLength(2),
    { timeout: 5000 },
  );
  expect(container.querySelector('[aria-label="App flow"]')).not.toBeNull();
  expect(container.querySelectorAll(".nb-app-grid-empty-output")).toHaveLength(
    1,
  );
  expect(
    container.querySelector(
      ".nb-chart-config, .nb-app-grid-controls, select, input, [contenteditable=true]",
    ),
  ).toBeNull();
});

it("opens an unbound chart in the notebook from its empty tile", async () => {
  const chart = cellSchema.parse({
    ...cell,
    id: "unbound",
    contents: {
      ...cell.contents,
      id: "unbound",
      kind: "chart",
      label: "Unbound chart",
      dataframe: null,
      chartSpec: {
        mark: "bar",
        xField: null,
        yField: null,
        seriesField: null,
        title: null,
      },
    },
  });
  const onViewCell = vi.fn();
  await renderBuilder({
    cells: [chart],
    outputs: {},
    canEdit: true,
    onChangeLayout: vi.fn(),
    onViewCell,
  });
  const tile = container.querySelector('section[aria-label="Unbound chart"]');
  assert(tile);
  const view = [...tile.querySelectorAll("button")].find(
    (button) => button.textContent === "View in notebook",
  );
  assert(view);
  await act(async () => view.click());
  expect(onViewCell).toHaveBeenCalledExactlyOnceWith(chart.id);
});

it("inserts Single value with the nearest dataframe onto the selected app tab", async () => {
  const source = cellSchema.parse({
    ...cell,
    id: "source",
    contents: {
      ...cell.contents,
      id: "source",
      kind: "sql",
      source: "select 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: "sales",
      outputResult: true,
    },
  });
  const cells = [source, cell];
  const layout = applyAppPatches(
    initialLayout(cells),
    [{ type: "tab-add", tabId: "details", name: "Details" }],
    cells,
  );
  let saved = layout;
  let inserted: Cell | undefined;
  const onInsertCell: NonNullable<BuilderProps["onInsertCell"]> = async (
    kind,
    placement,
  ) => {
    const draft = appCellDraft(appBuilderCellKindSchema.parse(kind), cells, []);
    const cellId = notebookCellIdSchema.parse("single-value");
    inserted = cellSchema.parse({
      ...cell,
      id: cellId,
      contents: { ...cell.contents, ...draft, id: cellId, order: "a2" },
    });
    saved = applyAppPatches(
      saved,
      [{ ...placement, type: "place", cellId }],
      [...cells, inserted],
    );
    return saved;
  };
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <TooltipProvider>
          <ProjectAppBuilder
            cells={cells}
            outputs={{}}
            canEdit
            layout={layout}
            tabBookmark="details"
            onChangeLayout={vi.fn()}
            onInsertCell={onInsertCell}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    ),
  );

  await act(async () => buttonNamed("Single value").click());
  expect(inserted?.contents).toMatchObject({
    kind: "metric",
    metricConfig: {
      source: { cellId: "source", exportId: "result" },
      mode: "aggregate",
    },
  });
  expect(
    projectAppLayout(saved, "details", true).rows.flatMap(({ columns }) =>
      columns.flatMap(({ elements }) => elements),
    ),
  ).toMatchObject([{ cellId: "single-value", heightPx: 160 }]);
  expect(saved.tabs[0]?.rows).toEqual(layout.tabs[0]?.rows);
});

it("report A2-BQ-V3-TABLE-PAGINATION: app tables page at 25 rows", async () => {
  const sql = cellSchema.parse({
    ...cell,
    id: "tbl",
    contents: {
      ...cell.contents,
      id: "tbl",
      kind: "sql",
      source: "select 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: "t",
      outputResult: true,
      gridX: 0,
      gridY: 0,
      gridWidth: 12,
    },
  });
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <TooltipProvider>
          <ProjectAppBuilder
            cells={[sql]}
            outputs={{
              tbl: {
                output: cellOutputSchema.parse({
                  type: "table",
                  columns: [{ name: "value", type: "string" }],
                  rows: Array.from({ length: 34 }, (_, i) => [String(i + 1)]),
                  rowCount: 34,
                  truncated: false,
                }),
              },
            }}
            canEdit={false}
            layout={legacyAppLayout([sql], revisionSchema.parse("0"))}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    ),
  );
  expect(container.textContent).toContain("Rows 1–25 of 34");
  expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
});

it("offers Classic and Generative app types before the layout is initialized", async () => {
  const cells = [cell];
  const onChangeLayout = vi.fn(async () => initialLayout(cells));
  await renderBuilder({
    cells,
    outputs: {},
    canEdit: true,
    onChangeLayout,
    layout: emptyAppLayout(revisionSchema.parse("0")),
  });
  const group = container.querySelector(
    '[role="group"][aria-label="APP TYPE"]',
  );
  assert(group);
  const headings = Array.from(group.querySelectorAll("h2")).map((h) =>
    h.textContent?.trim(),
  );
  expect(headings).toEqual(["Classic app", "Generative appBeta"]);
  const buttons = Array.from(group.querySelectorAll("button"));
  const generative = buttons.find((b) => b.textContent === "Not available yet");
  assert(generative);
  expect(generative.disabled).toBe(true);
  const classic = buttons.find((b) => b.textContent === "Edit app manually");
  assert(classic);
  await act(async () => classic.click());
  expect(onChangeLayout).toHaveBeenCalledWith([{ type: "initialize" }]);
});

it("hands the Generative app choice to the agent, then initializes the layout", async () => {
  const cells = [cell];
  const calls: string[] = [];
  const onGenerate = vi.fn(async () => {
    calls.push("generate");
  });
  const onChangeLayout = vi.fn(async () => {
    calls.push("initialize");
    return initialLayout(cells);
  });
  await renderBuilder({
    cells,
    outputs: {},
    canEdit: true,
    onChangeLayout,
    onGenerate,
    layout: emptyAppLayout(revisionSchema.parse("0")),
  });
  const generative = buttonNamed("Generate with the agent");
  expect(generative.disabled).toBe(false);
  expect(container.textContent).not.toContain("Not available yet");
  await act(async () => generative.click());
  expect(onGenerate).toHaveBeenCalledWith(
    expect.stringContaining("generative app"),
  );
  expect(calls).toEqual(["generate", "initialize"]);
  expect(onChangeLayout).toHaveBeenCalledWith([{ type: "initialize" }]);
});

it("keeps the layout uninitialized and reports it when the agent cannot be reached", async () => {
  const cells = [cell];
  const onGenerate = vi.fn(async () => {
    throw new Error("Connect an AI provider to start.");
  });
  const onChangeLayout = vi.fn(async () => initialLayout(cells));
  const notify = vi.spyOn(toast, "error").mockImplementation(() => "generate");
  await renderBuilder({
    cells,
    outputs: {},
    canEdit: true,
    onChangeLayout,
    onGenerate,
    layout: emptyAppLayout(revisionSchema.parse("0")),
  });
  await act(async () => buttonNamed("Generate with the agent").click());
  expect(notify).toHaveBeenCalledWith("Connect an AI provider to start.");
  expect(onChangeLayout).not.toHaveBeenCalled();
});
