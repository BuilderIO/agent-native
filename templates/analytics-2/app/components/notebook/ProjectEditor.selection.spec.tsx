// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { EditorView } from "@uiw/react-codemirror";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import { loadNotebookCell } from "../workspace/route-critical-code";
import { CELL_DRAG_TYPE } from "./cell-drag";
import { ProjectEditor } from "./ProjectEditor";
import type { ProjectEditorProps } from "./types";

const labs = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/components/shell/secondary-features", () => ({
  secondaryFeaturesEnabled: () => labs.enabled,
}));
beforeAll(() => loadNotebookCell());
beforeEach(() => {
  labs.enabled = true;
});

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/hooks", () => {
  const reads: Record<string, unknown> = {
    "list-components": { components: [] },
    "list-data-statuses": { statuses: [], defaultStatusId: null },
    "list-project-categories": { categories: [], assignments: [] },
    "get-workspace-shell": {
      features: { isManagerOrAbove: false, isAdmin: false },
    },
  };
  return {
    getBrowserTabId: () => "test-tab",
    actionErrorMessage: () => null,
    writeClientAppState: vi.fn(async () => {}),
    compareAndSetClientAppState: vi.fn(async () => {}),
    useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
    useActionQuery: (name: string) => ({
      data: reads[name],
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;
const sql = (
  id: string,
  order: string,
  source: string,
  variable: string | null,
) => ({
  id,
  projectId: "prj_sel",
  versionId: "ver_1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  contents: {
    ...base,
    id,
    order,
    kind: "sql" as const,
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: variable,
    outputResult: true,
  },
});
const project = {
  id: "prj_sel",
  title: "Selection project",
  description: "",
  language: "python",
  ownerEmail: "qa@workspace.test",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  collectionIds: [],
  cells: [
    sql("cel_a", "a0", "select 1", "df_a"),
    sql("cel_b", "a1", "select * from df_a", "df_b"),
    sql("cel_c", "a2", "select 2", "df_c"),
  ],
  versions: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
} as unknown as ProjectDocument;

const props = {
  connections: [],
  onRename: async () => {},
  onSaveCell: async () => {},
  onAddCell: async () => "new-cell",
  onDeleteCell: async () => {},
  onRunCell: async () => {},
  onSelectConnection: async () => {},
};

const wrap = (node: React.ReactNode) => (
  <AgentNativeI18nProvider
    catalog={{ messages: enUS }}
    persistPreference={false}
  >
    <MemoryRouter>{node}</MemoryRouter>
  </AgentNativeI18nProvider>
);

const openSelectCellAnd = () =>
  act(async () => {
    const sub = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((entry) => entry.textContent.trim() === "Select cell and...");
    sub?.focus();
    sub?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });

const selectedIds = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-notebook-cell]")]
    .filter((cell) => cell.classList.contains("is-selected"))
    .map((cell) => cell.dataset.notebookCell);

const menuItemNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) =>
      entry.getAttribute("aria-label") === name ||
      entry.textContent.trim() === name,
  );
const openDropdown = (trigger: HTMLElement | undefined | null) =>
  act(async () => {
    expect(trigger).toBeTruthy();
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
  });

it("offers Section from both the notebook More menu and the gap's More menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAddCell = vi.fn<ProjectEditorProps["onAddCell"]>(
    async () => "cel_section",
  );
  try {
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor {...props} project={project} onAddCell={onAddCell} />,
        ),
      ),
    );
    const more = (parent: ParentNode | null | undefined) =>
      [...(parent?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (button) => button.textContent.trim() === "More",
      );
    await openDropdown(
      more([...container.querySelectorAll(".nb-add-surface")].at(-1) ?? null),
    );
    expect(menuItemNamed("Section")).toBeDefined();
    await act(async () => menuItemNamed("Section")?.click());
    expect(onAddCell.mock.calls[0]?.[0]).toBe("collapsible");

    const slot = container.querySelector(
      '[data-notebook-cell="cel_a"]',
    )?.parentElement;
    await act(async () =>
      slot?.querySelector<HTMLButtonElement>(".nb-insert-button")?.click(),
    );
    await openDropdown(more(slot));
    expect(menuItemNamed("Section")).toBeDefined();
    await act(async () => menuItemNamed("Section")?.click());
    expect(onAddCell.mock.calls[1]?.slice(0, 2)).toEqual([
      "collapsible",
      "cel_a",
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("groups the selected cells into a new section in one operation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSectionChange = vi.fn(async () => {});
  const sectionProps = { onSectionChange };
  try {
    await act(async () =>
      root.render(
        wrap(<ProjectEditor {...props} {...sectionProps} project={project} />),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          '[data-notebook-cell="cel_b"] [aria-label^="More actions for"]',
        )
        ?.click(),
    );
    await openSelectCellAnd();
    await act(async () => menuItemNamed("all upstream")?.click());
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b"]);
    const bar = container.querySelector(".nb-selection-bar");
    const addToSection = [...(bar?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.trim() === "Add to section",
    );
    expect(addToSection).toBeDefined();
    await openDropdown(addToSection);
    await act(async () => menuItemNamed("New Section")?.click());
    expect(onSectionChange).toHaveBeenCalledExactlyOnceWith({
      type: "group-section",
      cellId: expect.any(String),
      cellIds: ["cel_a", "cel_b"],
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("opens collapsed sections, moves between levels by keyboard and drag, and confirms a nonempty deletion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSectionChange = vi.fn<
    NonNullable<ProjectEditorProps["onSectionChange"]>
  >(async () => {});
  const lead = sql("cel_a", "a1", "select 1", "df_a");
  const child = sql("cel_b", "a2", "select 2", "df_b");
  const tail = sql("cel_c", "a3", "select 3", "df_c");
  const section = {
    ...lead,
    id: "cel_section",
    contents: {
      ...base,
      id: "cel_section",
      order: "a0",
      kind: "collapsible",
      title: "Results",
      collapsed: true,
    },
  };
  const nested = {
    ...child,
    contents: { ...child.contents, parentSectionId: section.id },
  };
  const article = (id: string) =>
    container.querySelector<HTMLElement>(`[data-notebook-cell="${id}"]`);
  const render = async (collapsed: boolean) =>
    act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            project={withCells([
              { ...section, contents: { ...section.contents, collapsed } },
              lead,
              nested,
              tail,
            ])}
            onSectionChange={onSectionChange}
          />,
        ),
      ),
    );
  const key = (id: string, key: string) =>
    act(async () =>
      article(id)?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key, ctrlKey: true }),
      ),
    );
  const drop = (draggedId: string, targetId: string, clientY: number) => {
    const event = new MouseEvent("drop", { bubbles: true, clientY });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: [CELL_DRAG_TYPE], getData: () => draggedId },
    });
    return act(async () => article(targetId)?.dispatchEvent(event));
  };
  try {
    await render(true);
    expect(article("cel_b")).toBeNull();
    await act(async () =>
      article(section.id)
        ?.querySelector<HTMLButtonElement>('[aria-label="Expand"]')
        ?.click(),
    );
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "set-section",
      cellId: section.id,
      config: { collapsed: false },
    });
    await render(false);
    expect(article("cel_b")).not.toBeNull();

    await key("cel_b", "ArrowLeft");
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "move-to-section",
      cellId: "cel_b",
      cellIds: ["cel_b"],
      parentSectionId: null,
      beforeCellId: "cel_a",
    });
    await key("cel_a", "ArrowRight");
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "move-to-section",
      cellId: "cel_a",
      cellIds: ["cel_a"],
      parentSectionId: section.id,
    });

    await drop("cel_b", "cel_a", -1);
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "move-to-section",
      cellId: "cel_b",
      cellIds: ["cel_b"],
      parentSectionId: null,
      beforeCellId: "cel_a",
    });

    await render(true);
    await drop("cel_c", section.id, 0);
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "move-to-section",
      cellId: "cel_c",
      cellIds: ["cel_c"],
      parentSectionId: section.id,
    });

    await openDropdown(
      article(section.id)?.querySelector<HTMLButtonElement>(
        '[aria-label="More actions for Results"]',
      ),
    );
    await act(async () => menuItemNamed("Delete cell")?.click());
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain(
      "Deleting this section will also delete all contained cells. Delete anyway?",
    );
    expect(onSectionChange).toHaveBeenCalledTimes(5);
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((button) => button.textContent.trim() === "Confirm");
    await act(async () => confirm?.click());
    expect(onSectionChange).toHaveBeenLastCalledWith({
      type: "remove-section",
      cellId: section.id,
      mode: "delete",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("runs a collapsed nested section as one target and reveals its failed child", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const section = (
    id: string,
    order: string,
    parentSectionId: string | null,
    collapsed: boolean,
  ) => ({
    ...sql(id, order, "", null),
    contents: {
      ...base,
      id,
      order,
      kind: "collapsible",
      title: id,
      collapsed,
      parentSectionId,
    },
  });
  const child = sql("cel_b", "a2", "select * from df_a", "df_b");
  const start = vi.fn(async () => true);
  const execution: NonNullable<ProjectEditorProps["execution"]> = {
    ready: true,
    cells: undefined,
    defaultMode: "auto",
    autoRerun: true,
    run: null,
    runningIds: new Set(),
    pending: false,
    stopping: false,
    start,
    cancel: async () => {},
    setSettings: async () => {},
  };
  const article = (id: string) =>
    container.querySelector<HTMLElement>(`[data-notebook-cell="${id}"]`);
  const nested = "Nested results";
  const data = withCells([
    section("Outer results", "a0", null, false),
    section(nested, "a1", "Outer results", true),
    { ...child, contents: { ...child.contents, parentSectionId: nested } },
    sql("cel_a", "a3", "select 1", "df_a"),
  ]);
  const render = (errored: boolean) =>
    act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            project={data}
            execution={execution}
            outputs={errored ? { cel_b: { status: "error" } } : {}}
          />,
        ),
      ),
    );
  try {
    await render(false);
    expect(article("cel_b")).toBeNull();
    const run = article(nested)?.querySelector<HTMLButtonElement>(
      '[aria-label="Run section"]',
    );
    expect(run).not.toBeNull();
    await act(async () => run?.click());
    expect(start).toHaveBeenCalledExactlyOnceWith({ sectionId: nested });
    expect(article("cel_b")).toBeNull();

    await render(true);
    const badge = article(nested)?.querySelector<HTMLButtonElement>(
      '[data-section-status="errored"]',
    );
    expect(badge?.textContent).toBe("1 cell errored");
    await act(async () => badge?.click());
    expect(document.activeElement).toBe(article("cel_b"));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("Select cell and... marks the cells it depends on, then clears with Escape or a new project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(wrap(<ProjectEditor {...props} project={project} />)),
    );
    const trigger = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_b"] [aria-label^="More actions for"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
    await openSelectCellAnd();
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find(
      // oracle-change: the cell menu nests related-cell selection under "Select cell and..." with the source's labels
      (entry) => entry.textContent.trim() === "all upstream",
    );
    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b"]);
    expect(container.querySelector(".nb-selection-bar")?.textContent).toContain(
      "2 cells selected",
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(selectedIds(container)).toEqual([]);
    expect(container.querySelector(".nb-selection-bar")).toBeNull();
    // Selecting again, then opening another project, drops the marks.
    await act(async () => trigger?.click());
    await openSelectCellAnd();
    const again = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find(
      (entry) =>
        // oracle-change: the cell menu nests related-cell selection under "Select cell and..." with the source's labels
        entry.textContent.trim() === "all upstream + downstream",
    );
    await act(async () => again?.click());
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b"]);
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            project={{ ...project, id: "prj_other" }}
          />,
        ),
      ),
    );
    expect(selectedIds(container)).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const textCell = (id: string, order: string, text: string) => ({
  id,
  projectId: "prj_sel",
  versionId: "ver_1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  contents: { ...base, id, order, kind: "text" as const, text },
});
const withCells = (cells: unknown[]) =>
  ({ ...project, cells }) as unknown as ProjectDocument;

async function openNewComponent(container: HTMLElement, cellId: string) {
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        `[data-notebook-cell="${cellId}"] [aria-label^="More actions for"]`,
      )
      ?.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent.trim() === "New component")
      ?.click(),
  );
}
const setValue = (
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) =>
  act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element?.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submitName = async (name: string) => {
  await setValue(
    document.querySelector<HTMLInputElement>(".nb-component-name"),
    name,
  );
  await act(async () => {
    document
      .querySelector(".nb-component-name")
      ?.closest("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

it("hides component creation from the cell menu when Labs is off", async () => {
  labs.enabled = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            project={project}
            onCreateComponent={async () => {}}
          />,
        ),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          '[data-notebook-cell="cel_b"] [aria-label^="More actions for"]',
        )
        ?.click(),
    );
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].map((item) => item.textContent.trim());
    expect(items).toContain("Add above");
    expect(items).not.toContain("New component");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("New component saves the cell and everything it is built from under a name", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const onCreateComponent = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            project={project}
            onCreateComponent={onCreateComponent}
          />,
        ),
      ),
    );
    await openNewComponent(container, "cel_b");
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b"]);
    await submitName("Orders");
    expect(onCreateComponent).toHaveBeenCalledWith("Orders", [
      "cel_a",
      "cel_b",
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("New component saves the text on screen first, in order, and does not create one when that save fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const order: string[] = [];
  let failSave = true;
  const onSaveCell = vi.fn(async (_cell: unknown, contents: unknown) => {
    order.push(`save:${JSON.stringify((contents as { text?: string }).text)}`);
    if (failSave) throw new Error("Save refused");
  });
  const onCreateComponent = vi.fn(async () => {
    order.push("create");
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            onSaveCell={onSaveCell as never}
            onCreateComponent={onCreateComponent}
            project={withCells([textCell("cel_t", "a0", "old note")])}
          />,
        ),
      ),
    );
    // oracle-change: text cells render as prose until Edit opens the editor, and the open dialog would take its focus, so the text is typed first
    await act(async () =>
      container.querySelector<HTMLElement>(".nb-md-edit")?.click(),
    );
    // Typed in the editor, not saved yet.
    await setValue(container.querySelector("textarea"), "new note");
    await openNewComponent(container, "cel_t");
    await submitName("Notes");
    expect(onCreateComponent).not.toHaveBeenCalled();
    expect(
      document
        .querySelector(".nb-component-name")
        ?.closest("form")
        ?.querySelector('[role="alert"]')?.textContent,
    ).toContain("Save refused");
    // After the save works, the component is created, with the save first.
    failSave = false;
    await submitName("Notes");
    expect(onCreateComponent).toHaveBeenCalledWith("Notes", ["cel_t"]);
    expect(order.slice(-2)).toEqual(['save:"new note"', "create"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("New component re-reads the cells it needs after every save, so an edit made while a save waits cannot leave a dependency out", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const gates = new Map<string, () => void>();
  const events: string[] = [];
  const onSaveCell = vi.fn((cellId: string, contents: unknown) => {
    events.push(`save:${cellId}:${(contents as { source?: string }).source}`);
    if (cellId !== "cel_b") return Promise.resolve();
    return new Promise<void>((resolve) => {
      gates.set(cellId, resolve);
    });
  });
  const onCreateComponent = vi.fn(
    async (_name: string, ids: readonly string[]) => {
      events.push(`create:${ids.join(",")}`);
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const edit = (cellId: string, text: string) =>
    act(async () => {
      const dom = container.querySelector<HTMLElement>(
        `[data-notebook-cell="${cellId}"] .cm-editor`,
      );
      const view = dom === null ? null : EditorView.findFromDOM(dom);
      if (view === null) throw new Error(`no editor for ${cellId}`);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    });
  try {
    await act(async () =>
      root.render(
        wrap(
          <ProjectEditor
            {...props}
            onSaveCell={onSaveCell as never}
            onCreateComponent={onCreateComponent}
            project={withCells([
              sql("cel_a", "a0", "select 1", "df_a"),
              sql("cel_b", "a1", "select 2", "df_b"),
              sql("cel_c", "a2", "select * from df_b", "df_c"),
            ])}
          />,
        ),
      ),
    );
    // C reads B, so the component is B and C. B has text typed but not saved.
    await edit("cel_b", "select 3");
    await openNewComponent(container, "cel_c");
    expect(selectedIds(container)).toEqual(["cel_b", "cel_c"]);
    // Start creating, then let B's save hang.
    await setValue(
      document.querySelector<HTMLInputElement>(".nb-component-name"),
      "Pair",
    );
    await act(async () => {
      document
        .querySelector(".nb-component-name")
        ?.closest("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(events).toEqual(["save:cel_b:select 3"]);
    // While B's save waits, C is edited to read A as well.
    await edit("cel_c", "select * from df_b join df_a");
    await act(async () => {
      gates.get("cel_b")?.();
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    });
    // Nothing was created from the older picture; the selection now has A, and
    // the new text on C is still there, unsaved, not discarded.
    expect(onCreateComponent).not.toHaveBeenCalled();
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b", "cel_c"]);
    expect(
      container.querySelector('[data-notebook-cell="cel_c"] .cm-content')
        ?.textContent,
    ).toContain("join df_a");
    expect(
      document
        .querySelector(".nb-component-name")
        ?.closest("form")
        ?.querySelector('[role="alert"]')?.textContent,
    ).toContain("selection was updated");
    // Creating again saves C's text first, then creates with all three cells.
    await submitName("Pair");
    expect(events.slice(-2)).toEqual([
      "save:cel_c:select * from df_b join df_a",
      "create:cel_a,cel_b,cel_c",
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("Select upstream and downstream follow an input read through the sql_literal filter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const literalInput = {
    id: "cel_pick",
    projectId: "prj_sel",
    versionId: "ver_1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    contents: {
      ...base,
      id: "cel_pick",
      order: "a0",
      kind: "input" as const,
      name: "selected_borough",
      inputType: "TEXT_INPUT" as const,
      defaultValueString: "Brooklyn",
    },
  };
  const literal = withCells([
    literalInput,
    sql(
      "cel_q",
      "a1",
      "SELECT * FROM t WHERE boroname = {{ selected_borough | sql_literal }}",
      "df_q",
    ),
    sql("cel_other", "a2", "select 2", "df_other"),
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const choose = async (cellId: string, label: string) => {
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          `[data-notebook-cell="${cellId}"] [aria-label^="More actions for"]`,
        )
        ?.click(),
    );
    await openSelectCellAnd();
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((entry) => entry.textContent.trim() === label)
        ?.click(),
    );
  };
  try {
    await act(async () =>
      root.render(wrap(<ProjectEditor {...props} project={literal} />)),
    );
    // oracle-change: the cell menu nests related-cell selection under "Select cell and..." with the source's labels
    await choose("cel_q", "all upstream");
    expect(selectedIds(container)).toEqual(["cel_pick", "cel_q"]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // oracle-change: the cell menu nests related-cell selection under "Select cell and..." with the source's labels
    await choose("cel_pick", "all downstream");
    expect(selectedIds(container)).toEqual(["cel_pick", "cel_q"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("command-mode Mod+A selects every cell and Shift+J / Shift+K extend the selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const press = (id: string, init: KeyboardEventInit) =>
    act(async () => {
      container
        .querySelector<HTMLElement>(`[data-notebook-cell="${id}"]`)
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
    });
  try {
    await act(async () =>
      root.render(wrap(<ProjectEditor {...props} project={project} />)),
    );
    await press("cel_c", { key: "K", shiftKey: true });
    expect(selectedIds(container)).toEqual(["cel_b", "cel_c"]);
    await press("cel_b", { key: "ArrowUp", shiftKey: true });
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b", "cel_c"]);
    await press("cel_a", { key: "Escape" });
    await press("cel_b", { key: "a", ctrlKey: true });
    expect(selectedIds(container)).toEqual(["cel_a", "cel_b", "cel_c"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("row 816 toggles the sidebar and opens the selected cell's agent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onUseAi = vi.fn();
  try {
    await act(async () =>
      root.render(
        wrap(<ProjectEditor {...props} project={project} onUseAi={onUseAi} />),
      ),
    );
    await vi.waitFor(
      () =>
        expect(
          container.querySelector('[data-notebook-cell="cel_a"]'),
        ).not.toBeNull(),
      { timeout: 30000 },
    );
    const cell = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    expect(cell).not.toBeNull();
    await act(async () => cell?.focus());
    const press = async (key: string, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      await act(async () =>
        (cell?.isConnected ? cell : window)!.dispatchEvent(event),
      );
      return event;
    };
    const agent = await press("M", { ctrlKey: true, shiftKey: true });
    expect(agent.defaultPrevented).toBe(true);
    expect(onUseAi).toHaveBeenCalledWith(
      expect.objectContaining({ cellId: "cel_a", projectId: project.id }),
      undefined,
    );
    const sidebar = await press("~", {
      altKey: true,
      shiftKey: true,
      code: "Backquote",
    });
    expect(sidebar.defaultPrevented).toBe(true);
    expect(
      container.querySelector('[aria-label="Workspace tools"]'),
    ).toBeNull();
    await press("~", { altKey: true, shiftKey: true, code: "Backquote" });
    expect(
      container.querySelector('[aria-label="Workspace tools"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-FIND-20261116-F11 Mod+click adds and toggles cells in multi-cell selection without starting rename", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(wrap(<ProjectEditor {...props} project={project} />)),
    );
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    const thirdTitle = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_c"] .nb-cell-title',
    );
    expect(first).not.toBeNull();
    expect(thirdTitle).not.toBeNull();
    await act(async () => first?.focus());
    expect(selectedIds(container)).toEqual(["cel_a"]);
    await act(async () => {
      thirdTitle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
          button: 0,
        }),
      );
      thirdTitle?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
          button: 0,
        }),
      );
    });
    expect(selectedIds(container)).toEqual(["cel_a", "cel_c"]);
    expect(container.querySelector(".nb-cell-title-input")).toBeNull();
    await act(async () => {
      thirdTitle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
          button: 0,
        }),
      );
      thirdTitle?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
          button: 0,
        }),
      );
    });
    expect(selectedIds(container)).toEqual(["cel_a"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
