// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

// Component-import cells read the workspace's components; the menu tests need none.
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

import {
  decodeCellFromClipboard,
  encodeCellForClipboard,
} from "./cell-clipboard";
import { NotebookCell } from "./NotebookCell";

const base = {
  id: "cell",
  order: "a",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

function cellOf(contents: Cell["contents"]): Cell {
  return {
    id: "cell",
    projectId: "project",
    versionId: "version",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    contents,
  };
}

const sqlCell = cellOf({
  ...base,
  kind: "sql",
  source: "SELECT 1",
  dataConnectionId: null,
  databaseSchema: null,
  resultVariable: null,
  outputResult: true,
});

function Wrapped({ children }: { children: React.ReactNode }) {
  return (
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      {children}
    </AgentNativeI18nProvider>
  );
}

function props(cell: Cell, extra: Record<string, unknown> = {}) {
  return {
    cell,
    title: "Cell",
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

async function openMenu(host: HTMLElement) {
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label^="More actions for"]',
  );
  assert(trigger);
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

async function openSubmenu(name: string) {
  const trigger = menuItem(name);
  assert(trigger);
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
}

function labels() {
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => {
    const text = item.textContent;
    assert(text);
    return text.trim();
  });
}

async function pasteIntoCell(host: HTMLElement) {
  const cell = host.querySelector<HTMLElement>(".nb-cell");
  assert(cell);
  await act(async () => {
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

it("report 1794948376: the cell menu offers the source's core actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onAddAbove = vi.fn();
  const onAddBelow = vi.fn();
  const onPasteCell = vi.fn();
  const onFormatSql = vi.fn().mockResolvedValue("SELECT\n  1\n");
  let clipboard = "";
  const writeText = vi.fn(async (text: string) => {
    clipboard = text;
  });
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText, readText: async () => clipboard },
  });
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onAddAbove,
              onAddBelow,
              onMoveUp: () => {},
              onMoveDown: () => {},
              onDuplicateCell: () => {},
              onSaveContents: () => {},
              onPasteCell,
              onFormatSql,
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    expect(labels()).toEqual([
      "Add above",
      "Add below",
      "Move up",
      "Move down",
      "Duplicate",
      "Copy cell",
      "Copy link",
      "Full screen",
      "Split CTEs",
      "Format SQL",
      "Delete cell",
    ]);
    const item = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent.trim() === name,
      );
    await act(async () => item("Add above")?.click());
    expect(onAddAbove).toHaveBeenCalledTimes(1);
    await openMenu(host);
    await act(async () => item("Add below")?.click());
    expect(onAddBelow).toHaveBeenCalledTimes(1);
    await openMenu(host);
    await act(async () => item("Copy cell")?.click());
    expect(decodeCellFromClipboard(clipboard)).toEqual({
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
    });
    await pasteIntoCell(host);
    expect(onPasteCell).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sql", source: "SELECT 1" }),
    );
    await openMenu(host);
    await act(async () => item("Format SQL")?.click());
    expect(onFormatSql).toHaveBeenCalledWith("SELECT 1");
    await openMenu(host);
    await openSubmenu("Copy link");
    await act(async () => item("in Notebook view")?.click());
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("#cell-cell"),
    );
    await openMenu(host);
    await act(async () => item("Full screen")?.click());
    expect(host.querySelector(".nb-cell.is-fullscreen")).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(host.querySelector(".nb-cell.is-fullscreen")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("round-trips every cell field and rejects text that is not a copied cell", () => {
  const chart = {
    ...base,
    kind: "chart",
    label: "Revenue",
    gridX: 1,
    gridY: 2,
    gridWidth: 6,
    gridHeight: 4,
    dataframe: "orders",
    chartSpec: {
      mark: "bar",
      xField: "day",
      yField: "total",
      seriesField: null,
      title: "Revenue",
    },
  } as unknown as Cell["contents"];
  const copied = decodeCellFromClipboard(encodeCellForClipboard(chart));
  expect(copied).toMatchObject({
    label: "Revenue",
    gridX: 1,
    gridWidth: 6,
    dataframe: "orders",
    chartSpec: { xField: "day", yField: "total" },
  });
  expect(copied).not.toHaveProperty("id");
  expect(decodeCellFromClipboard("SELECT 1")).toBeNull();
  expect(decodeCellFromClipboard('{"kind":"sql"}')).toBeNull();
});

it("does not copy an unreviewed agent edit", () => {
  const withEdit = {
    ...sqlCell.contents,
    pendingEdit: { proposalId: "p", source: "DROP TABLE x" },
  } as unknown as Cell["contents"];
  expect(encodeCellForClipboard(withEdit)).not.toContain("DROP TABLE");
});

it("report 1794946078: an existing Python cell shows its source and says it cannot run", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const python = cellOf({
    ...base,
    kind: "code",
    language: "python",
    source: "print('hello')",
    resultVariable: null,
    outputResult: false,
  });
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell {...props(python, { draftText: "print('hello')" })} />
        </Wrapped>,
      ),
    );
    expect(host.textContent).toContain("print('hello')");
    // oracle-change: this workspace runs Python cells on its kernel, so the cell offers Run instead of a cannot-run notice
    expect(host.querySelector('[aria-label^="Run"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubClipboard(initial: string) {
  const clipboard = { text: initial };
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: {
      writeText: async (text: string) => {
        clipboard.text = text;
      },
      readText: async () => clipboard.text,
    },
  });
  return clipboard;
}

const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent.trim() === name,
  );

it("a rejected paste is reported, never shown as success, and cannot be double-submitted while pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clipboard = stubClipboard(encodeCellForClipboard(sqlCell.contents));
  const pending = deferred<void>();
  const onPasteCell = vi.fn(() => pending.promise);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell {...props(sqlCell, { onPasteCell })} />
        </Wrapped>,
      ),
    );
    await pasteIntoCell(host);
    expect(onPasteCell).toHaveBeenCalledTimes(1);
    await pasteIntoCell(host);
    expect(onPasteCell).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error("write refused"));
      await pending.promise.catch(() => {});
    });
    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("could not be pasted");
    expect(host.textContent).not.toContain("Cell pasted");
    // The clipboard is untouched so the person can retry.
    expect(clipboard.text).toBe(encodeCellForClipboard(sqlCell.contents));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function FormatHarness({
  initial,
  onFormatSql,
  expose,
  cell = sqlCell,
}: {
  initial: string;
  onFormatSql: (sql: string) => Promise<string>;
  expose: (set: (text: string) => void) => void;
  cell?: Cell;
}) {
  const [text, setText] = useState(initial);
  expose(setText);
  return (
    <Wrapped>
      <NotebookCell
        {...props(cell, {
          onFormatSql,
          draftText: text,
          onTextChange: setText,
        })}
      />
    </Wrapped>
  );
}

it("Format SQL never overwrites text typed while the formatter was running", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  stubClipboard("");
  const pending = deferred<string>();
  let setText: (text: string) => void = () => {};
  const seen: string[] = [];
  try {
    await act(async () =>
      root.render(
        <FormatHarness
          initial="SELECT 1"
          onFormatSql={() => pending.promise}
          expose={(set) => {
            setText = (text) => {
              seen.push(text);
              set(text);
            };
          }}
        />,
      ),
    );
    await openMenu(host);
    await act(async () => menuItem("Format SQL")?.click());
    await act(async () => setText("SELECT 2 -- newer edit"));
    await act(async () => {
      pending.resolve("SELECT\n  1\n");
      await pending.promise;
    });
    expect(host.textContent).toContain("SELECT 2 -- newer edit");
    expect(host.textContent).not.toContain("SELECT\n  1");
    expect(seen).toEqual(["SELECT 2 -- newer edit"]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "changed while",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Format SQL applies when the source is unchanged and keeps the original on a formatter error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  stubClipboard("");
  const onFormatSql = vi
    .fn<(sql: string) => Promise<string>>()
    .mockResolvedValueOnce("SELECT\n  1\n")
    .mockRejectedValueOnce(new Error("This SQL could not be parsed."));
  try {
    await act(async () =>
      root.render(
        <FormatHarness
          initial="select 1"
          onFormatSql={onFormatSql}
          expose={() => {}}
        />,
      ),
    );
    await openMenu(host);
    await act(async () => menuItem("Format SQL")?.click());
    expect(host.textContent).toContain("SELECT");
    expect(host.textContent).toContain("SQL formatted");
    await openMenu(host);
    await act(async () => menuItem("Format SQL")?.click());
    expect(host.textContent).toContain("This SQL could not be parsed.");
    expect(host.textContent).toContain("SELECT");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Copy cell carries the visible unsaved draft and keeps every other field, without saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clipboard = stubClipboard("");
  const onSaveDraft = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              draftText: "select 99 -- typed, not yet saved",
              onSaveDraft,
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    await act(async () => menuItem("Copy cell")?.click());
    const copied = decodeCellFromClipboard(clipboard.text);
    expect(copied).toMatchObject({
      ...Object.fromEntries(
        Object.entries(sqlCell.contents).filter(
          ([key]) => key !== "id" && key !== "order" && key !== "source",
        ),
      ),
      source: "select 99 -- typed, not yet saved",
    });
    expect(onSaveDraft).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Format SQL does nothing when its cell was unmounted while the formatter ran", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  stubClipboard("");
  const pending = deferred<string>();
  const onTextChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onFormatSql: () => pending.promise,
              onTextChange,
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    await act(async () => menuItem("Format SQL")?.click());
    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve("SELECT\n  1\n");
      await pending.promise;
    });
    expect(onTextChange).not.toHaveBeenCalled();
  } finally {
    host.remove();
  }
});

it.each([
  [
    "input",
    {
      kind: "input",
      name: "p",
      inputType: "TEXT_INPUT",
      defaultValueString: "",
    },
    { fullScreen: false, copy: true },
  ],
  [
    "metric",
    {
      kind: "metric",
      valueVariableName: null,
      valueRowIndex: null,
      resultVariable: null,
      outputResult: false,
      format: null,
    },
    { fullScreen: false, copy: true },
  ],
  [
    "component-import",
    { kind: "component-import", componentVersionId: null, title: null },
    { fullScreen: false, copy: false },
  ],
  [
    "collapsible",
    { kind: "collapsible", title: null, collapsed: false },
    { fullScreen: false, copy: false },
  ],
  ["sql", { ...sqlCell.contents }, { fullScreen: true, copy: true }],
] as const)(
  "the %s cell menu offers Full screen and Copy/Duplicate only where the reference does",
  async (_kind, contents, expected) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    stubClipboard("");
    try {
      await act(async () =>
        root.render(
          <Wrapped>
            <NotebookCell
              {...props(cellOf({ ...base, ...contents } as Cell["contents"]), {
                onDuplicateCell: () => {},
              })}
            />
          </Wrapped>,
        ),
      );
      await openMenu(host);
      expect(menuItem("Full screen") != null).toBe(expected.fullScreen);
      expect(menuItem("Copy cell") != null).toBe(expected.copy);
      expect(menuItem("Duplicate") != null).toBe(expected.copy);
      // Every kind keeps a link: one for imports and collapsibles, a notebook
      // link plus a published-app link for the rest.
      expect(
        menuItem("Copy link") ?? menuItem("in Notebook view"),
      ).toBeDefined();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("Copy link offers the notebook view, and the latest published app only once published", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clipboard = stubClipboard("");
  window.history.replaceState(
    null,
    "",
    "/analytics-2/project/project/latest/app",
  );
  const render = async (hasPublishedApp: boolean) =>
    act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell {...props(sqlCell, { hasPublishedApp })} />
        </Wrapped>,
      ),
    );
  try {
    await render(false);
    await openMenu(host);
    await openSubmenu("Copy link");
    const notebookItem = menuItem("in Notebook view");
    const appItem = menuItem("in the latest Published App");
    expect(notebookItem?.getAttribute("aria-disabled") === "true").toBe(false);
    expect(appItem?.getAttribute("aria-disabled") === "true").toBe(true);
    expect(appItem?.getAttribute("title")).toBe(
      "Publish the app at least once to link it",
    );
    await act(async () => appItem?.click());
    expect(clipboard.text).toBe("");
    await act(async () => notebookItem?.click());
    // The editor's Agent or App route is never what a copied link names.
    expect(clipboard.text).toBe(
      `${window.location.origin}/analytics-2/project/project/latest/logic#cell-cell`,
    );
    await render(true);
    await openMenu(host);
    await openSubmenu("Copy link");
    const published = menuItem("in the latest Published App");
    expect(published?.getAttribute("aria-disabled") === "true").toBe(false);
    await act(async () => published?.click());
    expect(clipboard.text).toBe(
      `${window.location.origin}/analytics-2/app/project/latest#cell-cell`,
    );
  } finally {
    window.history.replaceState(null, "", "/");
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Select cell and... and Embed appear only where the reference offers them, and Embed waits for a publish", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  stubClipboard("");
  const onSelectRelated = vi.fn();
  const onEmbed = vi.fn();
  const render = async (cell: Cell, extra: Record<string, unknown>) =>
    act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(cell, { onSelectRelated, onEmbed, ...extra })}
          />
        </Wrapped>,
      ),
    );
  try {
    await render(sqlCell, { hasPublishedApp: false });
    await openMenu(host);
    expect(menuItem("Select cell and...")).toBeDefined();
    for (const [label, relation] of [
      ["all upstream", "upstream"],
      ["all downstream", "downstream"],
      ["all upstream + downstream", "both"],
    ] as const) {
      await openSubmenu("Select cell and...");
      assert(menuItem(label));
      await act(async () => menuItem(label)?.click());
      expect(onSelectRelated).toHaveBeenLastCalledWith(relation);
      await openMenu(host);
    }
    const embed = menuItem("Embed");
    expect(embed?.getAttribute("aria-disabled") === "true").toBe(true);
    expect(embed?.getAttribute("title")).toBe(
      "Publish the app at least once to embed it",
    );
    await act(async () => embed?.click());
    expect(onEmbed).not.toHaveBeenCalled();
    // The menu is still open across this re-render.
    await render(sqlCell, { hasPublishedApp: true });
    await act(async () => menuItem("Embed")?.click());
    expect(onEmbed).toHaveBeenCalledTimes(1);
    // New component appears only when the caller can create one.
    expect(menuItem("New component")).toBeUndefined();
    const onNewComponent = vi.fn();
    await render(sqlCell, { hasPublishedApp: true, onNewComponent });
    await openMenu(host);
    await act(async () => menuItem("New component")?.click());
    expect(onNewComponent).toHaveBeenCalledTimes(1);
    // Imported components and collapsibles offer neither.
    await render(
      cellOf({
        ...base,
        kind: "collapsible",
        title: null,
        collapsed: false,
      } as Cell["contents"]),
      { hasPublishedApp: true },
    );
    await openMenu(host);
    expect(menuItem("Embed")).toBeUndefined();
    expect(menuItem("all upstream")).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("Copy cell reports an unavailable Clipboard API without pretending to copy", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell {...props(sqlCell)} />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    const copy = menuItem("Copy cell");
    assert(copy);
    await act(async () => copy.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Copy is not available in this browser",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("uses the selection-advancing delete handler from the cell menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommandDelete = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell {...props(sqlCell, { onCommandDelete })} />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    const remove = menuItem("Delete cell");
    assert(remove);
    await act(async () => remove.click());
    expect(onCommandDelete).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("shows a SQL failure callout without a collapsible output header or stale badge", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const message = "Syntax error: Unexpected end of script at [1:14]";
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              staleOutput: true,
              outputState: {
                status: "error",
                output: { type: "error", message, detail: "attempt-id" },
              },
            })}
          />
        </Wrapped>,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      message,
    );
    expect(host.querySelector(".nb-output-header")).toBeNull();
    expect(host.textContent).not.toContain("Stale output");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("report A2-FIND-1120F-S1-6 prints cell menu shortcut hints with a single Esc prefix", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onAddAbove: () => {},
              onAddBelow: () => {},
            })}
          />
        </Wrapped>,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label^="More actions for"]',
    );
    assert(trigger);
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const addAbove = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) =>
      item.textContent?.includes(enUS.notebook.cellMenu.addAbove),
    );
    assert(addAbove);
    expect(addAbove.getAttribute("data-shortcut")).toBe("ESC then A");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

function menuStructure() {
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert(menu);
  return [...menu.children].map((child) =>
    child.getAttribute("role") === "separator"
      ? "---"
      : (child.textContent ?? "").trim(),
  );
}

it("row 555: separates cell menu action groups with dividers across SQL, text, and collapsible cells", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onAddAbove: () => {},
              onAddBelow: () => {},
              onMoveUp: () => {},
              onMoveDown: () => {},
              onDuplicateCell: () => {},
              onSelectRelated: () => {},
              onNewComponent: () => {},
              onEmbed: () => {},
              onSaveContents: () => {},
              onFormatSql: async () => "SELECT 1",
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    expect(menuStructure()).toEqual([
      "Add above",
      "Add below",
      "Move up",
      "Move down",
      "---",
      "Duplicate",
      "Select cell and...",
      "New component",
      "Copy cell",
      "---",
      "Copy link",
      "Embed",
      "Full screen",
      "---",
      "Split CTEs",
      "Format SQL",
      "---",
      "Delete cell",
    ]);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    const textCell = cellOf({
      ...base,
      kind: "text",
      text: "Notes",
    });
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(textCell, {
              draftText: "Notes",
              onAddBelow: () => {},
              onDuplicateCell: () => {},
              onSaveContents: () => {},
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    expect(menuStructure()).toEqual([
      "Add below",
      "---",
      "Duplicate",
      "Copy cell",
      "---",
      "Copy link",
      "Full screen",
      "---",
      "Convert to Markdown",
      "---",
      "Delete cell",
    ]);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    const collapsibleCell = cellOf({
      ...base,
      kind: "collapsible",
      title: "Section",
      collapsed: false,
    });
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(collapsibleCell, {
              onAddBelow: () => {},
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    expect(menuStructure()).toEqual([
      "Add below",
      "---",
      "Copy link",
      "---",
      "Delete cell",
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("row 555: dismisses the cell menu on Escape with focus restored to trigger and on outside pointer interaction", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const outside = document.createElement("button");
  outside.type = "button";
  outside.textContent = "Outside";
  document.body.append(outside, host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onAddBelow: () => {},
              onDuplicateCell: () => {},
            })}
          />
        </Wrapped>,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label^="More actions for"]',
    );
    assert(trigger);

    await openMenu(host);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await openMenu(host);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      outside.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      outside.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      outside.click();
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    outside.remove();
    vi.unstubAllGlobals();
  }
});
