import { writeClientAppState } from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
// @vitest-environment happy-dom
import { EditorView } from "@uiw/react-codemirror";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import "./NotebookCell";
import { runReceiptSchema } from "../../../shared/notebook-execution";
import {
  publishNotebookEditing,
  waitForNotebookEditing,
} from "./editing-snapshot";
import { ProjectEditor as View } from "./ProjectEditor";

function ProjectEditor(props: ComponentProps<typeof View>) {
  return (
    <AgentNativeI18nProvider catalog={{ messages: enUS }}>
      <MemoryRouter>
        <View {...props} />
      </MemoryRouter>
    </AgentNativeI18nProvider>
  );
}

function execution(
  overrides: Partial<NonNullable<ComponentProps<typeof View>["execution"]>>,
) {
  return {
    ready: true,
    cells: undefined,
    defaultMode: "auto" as const,
    autoRerun: true,
    run: null,
    runningIds: new Set<string>(),
    pending: false,
    stopping: false,
    start: async () => true,
    cancel: async () => {},
    setSettings: async () => {},
    ...overrides,
  };
}

// The editor reads the workspace's components from a query when that panel is
// open; the app shell provides the query client, so the test stubs the hook the
// same way the component's own specs do.
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  actionErrorCode: () => null,
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: undefined, isPending: false, error: null }),
  useActionMutation: () => ({ mutateAsync: async () => ({}) }),
}));

it("navigates and acts on the selected notebook cell without taking typing keys", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onMoveCell = vi.fn(async () => {});
  const onDeleteCell = vi.fn(async () => {});
  const onAddCell = vi.fn(async () => "new-cell");
  const onSelectView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{
            ...project,
            cells: [
              project.cells[0]!,
              project.cells[1]!,
              {
                id: "cel_input",
                projectId: project.id,
                versionId: project.workingVersionId,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                contents: {
                  ...base,
                  id: "cel_input",
                  kind: "input",
                  order: "a2",
                  name: "Choice",
                  inputType: "DROPDOWN",
                  defaultValueString: "",
                  options: [],
                  optional: false,
                },
              },
            ],
          }}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={onAddCell}
          onDeleteCell={onDeleteCell}
          onMoveCell={onMoveCell}
          onSelectView={onSelectView}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const cells = [
      ...container.querySelectorAll<HTMLElement>("[data-notebook-cell]"),
    ];
    const key = (
      target: Element,
      value: string,
      options: KeyboardEventInit = {},
    ) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    await act(async () => {
      cells[0]!.focus();
      key(cells[0]!, "j");
    });
    expect(document.activeElement).toBe(cells[1]);
    const selectedCell = cells[1];
    assert(selectedCell);
    await act(async () => {
      key(selectedCell, "f", { metaKey: true, shiftKey: true });
    });
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    assert(search);
    expect(document.activeElement).toBe(search);
    await act(async () => {
      selectedCell.focus();
      key(selectedCell, "f", { ctrlKey: true });
    });
    expect(document.activeElement).toBe(search);
    await act(async () => {
      key(search, "Escape");
    });
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(document.activeElement).toBe(cells[1]);
    const slot = selectedCell.closest(".nb-cell-slot");
    assert(slot);
    const gapSelector = '[role="group"][aria-label="Add code cell"]';
    await act(async () => {
      key(selectedCell, "a", { altKey: true });
    });
    const addGap = slot.querySelector(gapSelector);
    assert(addGap);
    const addChoice = addGap.querySelector<HTMLButtonElement>("button");
    assert(addChoice);
    expect(addChoice.textContent).toContain("Query");
    expect(document.activeElement).toBe(addChoice);
    await act(async () => addChoice.click());
    expect(onAddCell).toHaveBeenLastCalledWith("sql", "cel_b", undefined);
    onAddCell.mockClear();
    await act(async () => selectedCell.focus());
    await act(async () => key(selectedCell, "a", { altKey: true }));
    const reopenedGap = slot.querySelector(gapSelector);
    assert(reopenedGap);
    const focusedChoice = document.activeElement;
    assert(focusedChoice);
    expect(reopenedGap.contains(focusedChoice)).toBe(true);
    await act(async () => key(focusedChoice, "Escape", { isComposing: true }));
    expect(reopenedGap.isConnected).toBe(true);
    await act(async () => key(focusedChoice, "Escape"));
    expect(slot.querySelector(gapSelector)).toBeNull();
    const gapTrigger = slot.querySelector("button.nb-insert-button");
    assert(gapTrigger);
    await vi.waitFor(() => expect(document.activeElement).toBe(gapTrigger));
    await act(async () => {
      selectedCell.focus();
      key(selectedCell, "a", { altKey: true, repeat: true });
      key(selectedCell, "a", { altKey: true, isComposing: true });
    });
    expect(slot.querySelector(gapSelector)).toBeNull();

    await act(async () => {
      key(cells[1]!, "¡", { code: "Digit1", altKey: true, shiftKey: true });
    });
    expect(onSelectView).toHaveBeenCalledWith("notebook");
    await act(async () => {
      key(cells[1]!, "ArrowUp", { metaKey: true });
      key(cells[1]!, "b");
    });
    expect(onMoveCell).toHaveBeenCalledWith("cel_b", "up");
    const below = cells[1]
      ?.closest(".nb-cell-slot")
      ?.querySelector(".nb-add-surface");
    assert(below?.contains(document.activeElement));
    await act(async () => key(document.activeElement ?? selectedCell, "n"));
    expect(onAddCell).toHaveBeenCalledWith("markdown", "cel_b", undefined);
    await act(async () => {
      cells[0]!.focus();
      key(cells[0]!, "a");
    });
    const above = container.querySelector(".nb-leading-insert .nb-add-surface");
    assert(above?.contains(document.activeElement));
    await act(async () => key(document.activeElement ?? selectedCell, "q"));
    expect(onAddCell).toHaveBeenCalledWith("sql", undefined, {
      beforeCellId: "cel_a",
    });
    await act(async () => {
      key(cells[1]!, "d");
      key(cells[1]!, "d");
      await Promise.resolve();
    });
    expect(onDeleteCell).toHaveBeenCalledWith("cel_b");
    expect(document.activeElement).toBe(cells[2]);
    await act(async () => {
      key(cells[2]!, "b");
    });
    const inputAdd = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".nb-insert.is-open .nb-add-button",
      ),
    ].find((button) => button.textContent === "Inputs");
    assert(inputAdd);
    await act(async () => key(inputAdd, "ArrowDown"));
    const dropdown = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Dropdown");
    assert(dropdown);
    await act(async () => dropdown.click());
    expect(onAddCell).toHaveBeenCalledWith("input", "cel_input", {
      inputType: "DROPDOWN",
    });
    // report 1794948257.991429: the SQL editor exposes code controls and syntax.
    expect(cells[0]!.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(cells[0]!.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(cells[0]!.querySelector(".cm-line span")).not.toBeNull();
    const textarea = cells[0]!.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      textarea.focus();
      key(textarea, "j");
    });
    await act(async () => key(textarea, "a", { altKey: true }));
    expect(
      textarea.closest(".nb-cell-slot")?.querySelector(gapSelector),
    ).toBeNull();
    expect(document.activeElement).toBe(textarea);
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, id: "project-next", cells: [] }}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={onAddCell}
          onDeleteCell={onDeleteCell}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const nextEditor = container.querySelector(".nb-root");
    assert(nextEditor);
    const nextChoice = nextEditor.querySelector<HTMLButtonElement>(
      `${gapSelector} button`,
    );
    assert(nextChoice);
    expect(nextChoice.textContent).toBe("Query");
    await act(async () => nextChoice.click());
    expect(onAddCell).toHaveBeenLastCalledWith("sql", undefined, undefined);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

vi.mock("@agent-native/toolkit/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

async function cellMenuItems(cell: Element) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await act(async () =>
    cell
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="More actions for "]',
      )
      ?.click(),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

function sqlCell(id: string, order: string, source: string) {
  return {
    id,
    contents: {
      ...base,
      id,
      kind: "sql" as const,
      order,
      source,
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  };
}

function markdownCell(id: string, order: string, markdown: string) {
  return {
    id,
    contents: { ...base, id, kind: "markdown" as const, order, markdown },
  };
}

const project = {
  id: "prj_run_all",
  ownerEmail: "qa@workspace.test",
  title: "Run all project",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  collectionIds: [],
  cells: [
    sqlCell("cel_a", "a0", "select 1"),
    markdownCell("cel_b", "a1", "# notes"),
    sqlCell("cel_c", "a2", "select 2"),
  ],
  versions: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
} as unknown as ProjectDocument;

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it("report ADHOC-1117-EDITING-SNAPSHOT retries a failed unchanged snapshot on the next submission", async () => {
  const write = vi.mocked(writeClientAppState);
  write.mockClear();
  const error = new Error("snapshot unavailable");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  write.mockRejectedValueOnce(error).mockResolvedValueOnce(null);
  try {
    publishNotebookEditing({
      projectId: "retry-project",
      cells: [],
      truncated: false,
    });
    await expect(waitForNotebookEditing("retry-project")).rejects.toThrow(
      "snapshot unavailable",
    );
    await expect(
      waitForNotebookEditing("retry-project"),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
    write.mockReset().mockResolvedValue(null);
  }
});

it("report ADHOC-1117-EDITING-SNAPSHOT publishes the visible draft before an immediate submission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferred();
  const write = vi.mocked(writeClientAppState);
  write.mockImplementation(async (key, value) => {
    if (
      key.startsWith("notebook-editing:") &&
      JSON.stringify(value).includes("select unsaved")
    )
      await pending.promise;
    return value;
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "new"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const editor = host.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () =>
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "select unsaved",
        },
      }),
    );
    expect(write).toHaveBeenLastCalledWith(
      "notebook-editing:test-tab",
      expect.objectContaining({
        projectId: project.id,
        cells: expect.arrayContaining([
          expect.objectContaining({
            id: "cel_a",
            text: "select unsaved",
            unsaved: true,
          }),
        ]),
      }),
      { requestSource: "test-tab" },
    );
    let completed = false;
    const submit = waitForNotebookEditing(project.id).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    pending.resolve();
    await submit;
    expect(completed).toBe(true);
    await act(async () =>
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "x".repeat(2100),
        },
      }),
    );
    expect(write).toHaveBeenLastCalledWith(
      "notebook-editing:test-tab",
      expect.objectContaining({
        cells: expect.arrayContaining([
          expect.objectContaining({
            id: "cel_a",
            text: "x".repeat(2000),
            truncated: true,
          }),
        ]),
      }),
      { requestSource: "test-tab" },
    );
  } finally {
    act(() => root.unmount());
    host.remove();
    write.mockReset().mockResolvedValue(null);
  }
});

it("reports ADHOC-1117-EDITING-SNAPSHOT and A2-CHART-AUTOSAVE-RACE for pending chart changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferred();
  const write = vi.mocked(writeClientAppState);
  const saveChart = vi.fn<ComponentProps<typeof ProjectEditor>["onSaveCell"]>(
    () => pending.promise,
  );
  const chart = {
    id: "cel_chart",
    contents: {
      ...base,
      id: "cel_chart",
      kind: "chart",
      order: "a2",
      dataframe: "df",
      chartSpec: {
        mark: "bar",
        xField: "day",
        yField: "revenue",
        seriesField: null,
        title: null,
      },
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, cells: [project.cells[1]!, chart as never] }}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={saveChart}
          onAddCell={async () => "new"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const markdown = host.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_b"]',
    );
    assert(markdown);
    const edit = [...markdown.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit",
    );
    assert(edit);
    await act(async () => edit.click());
    const textarea = markdown.querySelector<HTMLTextAreaElement>("textarea");
    assert(textarea);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      assert(setter);
      setter.call(textarea, "Draft note");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const line = [
      ...host.querySelectorAll<HTMLButtonElement>(".nb-chart-type"),
    ].find((button) => button.textContent?.trim() === "Line");
    assert(line);
    await act(async () => line.click());
    const title = host.querySelector<HTMLInputElement>(
      'input[aria-label="Chart title"]',
    );
    assert(title);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setter);
      setter.call(title, "Revenue trend");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    // Another cell's debounced autosave may run after the chart write.
    const chartWrites = saveChart.mock.calls.filter(
      ([cellId]) => cellId === "cel_chart",
    );
    expect(chartWrites.at(-1)).toEqual([
      "cel_chart",
      expect.objectContaining({
        chartSpec: expect.objectContaining({
          mark: "line",
          title: "Revenue trend",
        }),
      }),
    ]);
    expect(write).toHaveBeenLastCalledWith(
      "notebook-editing:test-tab",
      expect.objectContaining({
        cells: expect.arrayContaining([
          expect.objectContaining({
            id: "cel_b",
            text: "Draft note",
            unsaved: true,
          }),
          expect.objectContaining({
            id: "cel_chart",
            kind: "chart",
            chartSpec: expect.objectContaining({
              mark: "line",
              xField: "day",
              yField: "revenue",
            }),
            unsaved: true,
          }),
        ]),
      }),
      { requestSource: "test-tab" },
    );
  } finally {
    pending.resolve();
    await act(async () => root.unmount());
    host.remove();
  }
});

it("report A2-CHART-AUTOSAVE-RACE restores the refreshed chart after a save conflict", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferredValue<string>();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const chart = {
    id: "cel_chart",
    contents: {
      ...base,
      id: "cel_chart",
      kind: "chart" as const,
      order: "a2",
      dataframe: "df",
      chartSpec: {
        mark: "bar" as const,
        xField: "day",
        yField: "revenue",
        seriesField: null,
        title: null as string | null,
      },
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (cell: typeof chart) =>
    root.render(
      <ProjectEditor
        project={{ ...project, cells: [cell as never] }}
        connections={[]}
        onRename={async () => {}}
        onSaveCell={() => pending.promise}
        onAddCell={async () => "new"}
        onDeleteCell={async () => {}}
        onRunCell={async () => {}}
        onSelectConnection={async () => {}}
      />,
    );
  try {
    await act(async () => render(chart));
    const button = (name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(".nb-chart-type")].find(
        (item) => item.textContent?.trim() === name,
      );
    const line = button("Line");
    assert(line);
    await act(async () => line.click());
    expect(line.getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      render({
        ...chart,
        contents: {
          ...chart.contents,
          chartSpec: { ...chart.contents.chartSpec, title: "Remote title" },
        },
      }),
    );
    await act(async () => {
      pending.reject(new Error("Changed elsewhere"));
    });
    expect(line.getAttribute("aria-pressed")).toBe("false");
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Chart title"]')
        ?.value,
    ).toBe("Remote title");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    log.mockRestore();
  }
});

// oracle-change: Run All now has one admission. The run-store and input specs prove branch membership and commit timing.
it("submits Run all once and keeps unrelated cells editable during the server run", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const start = vi.fn(async () => true);
  const onSaveCell = vi.fn(async () => "saved-revision");
  const run = runReceiptSchema.parse({
    status: "admitted",
    runId: "run-all",
    request: {
      requestId: "request",
      snapshot: {
        ref: {
          workspaceId: "workspace",
          projectId: project.id,
          head: { versionId: project.workingVersionId, revision: "1" },
          eventSeq: "1",
        },
        namespace: { kind: "draft", namespaceId: "notebook" },
        inputRevision: "0",
        executionFingerprint: "fingerprint",
      },
      mode: "run-all",
      restart: false,
      cache: "reuse",
    },
    startedAt: "2026-11-18T08:00:00Z",
    plan: {
      admittedCellIds: ["cel_a", "cel_c"],
      dependencyResultIds: [],
      rejectedCells: [],
    },
    attempts: [
      ["cel_a", "running"],
      ["cel_c", "queued"],
    ].map(([cellId, status]) => ({
      attempt: {
        namespaceId: "notebook",
        cellId,
        runId: "run-all",
        attemptId: `attempt-${cellId}`,
        outputGeneration: "1",
      },
      state: { status },
    })),
    cursor: "2",
  });
  const onDeleteCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (running = false) =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={onSaveCell}
          onAddCell={async () => "test-cell"}
          onDeleteCell={onDeleteCell}
          execution={execution({
            start,
            run: running ? run : null,
            runningIds: new Set(running ? ["cel_a", "cel_c"] : []),
          })}
          onSelectConnection={async () => {}}
        />
      </AgentNativeI18nProvider>,
    );
  try {
    await act(async () => render());
    const runAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Run all",
    );
    assert(runAll);
    expect(runAll.disabled).toBe(false);
    await act(async () => runAll.click());
    expect(start).toHaveBeenCalledExactlyOnceWith({ all: true });
    await act(async () => render(true));
    expect(runAll.disabled).toBe(true);
    const progress = container.querySelector(".nb-run-progress");
    assert(progress);
    expect(progress.textContent).toContain("0 / 2 cells complete");
    expect(
      [...container.querySelectorAll(".nb-run-progress-label")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["SQL 1", "SQL 3"]);
    expect(
      [...container.querySelectorAll(".nb-run-progress-status")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Running…", "Queued…"]);
    const active = container.querySelector<HTMLButtonElement>(
      '[data-notebook-cell="cel_a"] button[aria-label^="More actions for"]',
    );
    expect(active?.disabled).toBe(true);
    const editor = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"] .cm-content',
    );
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    const source = "select 84 as sentinel";
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
      });
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(onSaveCell).toHaveBeenCalledExactlyOnceWith(
      "cel_a",
      expect.objectContaining({ source }),
      project.cells.find(({ id }) => id === "cel_a")?.updatedAt,
    );
    const selected = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_b"]',
    );
    assert(selected);
    expect(
      selected.querySelector<HTMLButtonElement>(
        'button[aria-label^="More actions for"]',
      )?.disabled,
    ).toBe(false);
    await act(async () => {
      selected.focus();
      for (let count = 0; count < 2; count += 1)
        selected.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", bubbles: true }),
        );
    });
    expect(onDeleteCell).toHaveBeenCalledExactlyOnceWith("cel_b");
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it("offers Move up and Move down inside the document, not at its ends", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onMoveCell = vi.fn(async () => {});
  const onDuplicateCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onMoveCell={onMoveCell}
          onDuplicateCell={onDuplicateCell}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      );
    });
    const slots = [...container.querySelectorAll(".nb-cell-slot")];
    expect(slots).toHaveLength(3);
    const labelsOf = async (slot: Element) =>
      (await cellMenuItems(slot)).map((item) => item.textContent?.trim());
    expect(await labelsOf(slots[0]!)).not.toContain("Move up");
    expect(await labelsOf(slots[0]!)).toContain("Move down");
    expect(await labelsOf(slots[1]!)).toEqual(
      expect.arrayContaining(["Move up", "Move down"]),
    );
    expect(await labelsOf(slots[2]!)).toContain("Move up");
    expect(await labelsOf(slots[2]!)).not.toContain("Move down");
    const down = (await cellMenuItems(slots[0]!)).find(
      (item) => item.textContent?.trim() === "Move down",
    );
    await act(async () => down?.click());
    expect(onMoveCell).toHaveBeenCalledWith("cel_a", "down");
    const duplicate = (await cellMenuItems(slots[1]!)).find(
      (item) => item.textContent?.trim() === "Duplicate",
    );
    if (!duplicate) throw Error("Duplicate cell item missing");
    await act(async () => duplicate.click());
    expect(onDuplicateCell).toHaveBeenCalledWith("cel_b");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("report A2-AUTOSAVE-RUN-DROPPED: keyboard run waits for an in-flight save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const pending = deferredValue<string>();
  const onSaveCell = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue("revision-3");
  const onRunCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={onSaveCell}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={onRunCell}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const editor = container.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    const replaceText = (text: string) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    await act(async () => {
      replaceText("select 2");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(onSaveCell).toHaveBeenCalledTimes(1);
    await act(async () => {
      replaceText("select 3");
    });
    await act(async () => {
      const currentEditor = container.querySelector<HTMLElement>(".cm-content");
      assert(currentEditor);
      currentEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    await act(async () => {
      pending.resolve("revision-2");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSaveCell).toHaveBeenCalledTimes(2);
    expect(onSaveCell.mock.calls[1]?.[1]).toMatchObject({ source: "select 3" });
    expect(onSaveCell.mock.calls[1]?.[2]).toBe("revision-2");
    expect(onRunCell).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("report 1794948257.991429 does not steal focus when a SQL editor mounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const input = document.createElement("input");
  const container = document.createElement("div");
  document.body.append(input, container);
  input.focus();
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    expect(container.querySelector(".cm-content")).not.toBeNull();
    expect(document.activeElement).toBe(input);
  } finally {
    act(() => root.unmount());
    input.remove();
    container.remove();
  }
});
it("report A2-KEYBOARD-DELETE-BUSY: deletes the selected cell while another cell saves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const pending = deferredValue<string>();
  const onSaveCell = vi.fn(() => pending.promise);
  const onDeleteCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={onSaveCell}
          onAddCell={async () => "test-cell"}
          onDeleteCell={onDeleteCell}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const editor = container.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "select 42" },
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(onSaveCell).toHaveBeenCalledTimes(1);
    const savingCell = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(savingCell);
    const savingMenu = savingCell.querySelector<HTMLButtonElement>(
      'button[aria-label^="More actions for "]',
    );
    assert(savingMenu);
    expect(savingMenu.disabled).toBe(true);
    await act(async () => {
      savingCell.focus();
      savingCell.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      savingCell.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
    });
    expect(onDeleteCell).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(savingCell);
    const selected = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_b"]',
    );
    assert(selected);
    const selectedMenu = selected.querySelector<HTMLButtonElement>(
      'button[aria-label^="More actions for "]',
    );
    assert(selectedMenu);
    expect(selectedMenu.disabled).toBe(false);
    const deleteItem = (await cellMenuItems(selected)).find((item) =>
      item.textContent?.trim().startsWith("Delete cell"),
    );
    assert(deleteItem);
    expect(deleteItem.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => {
      selected.focus();
      selected.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      selected.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(onDeleteCell).toHaveBeenCalledWith("cel_b");
    const third = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_c"]',
    );
    assert(third);
    const thirdDelete = (await cellMenuItems(third)).find((item) =>
      item.textContent?.trim().startsWith("Delete cell"),
    );
    assert(thirdDelete);
    await act(async () => thirdDelete.click());
    expect(onDeleteCell).toHaveBeenCalledWith("cel_c");
  } finally {
    await act(async () => {
      pending.resolve("revision-2");
      await Promise.resolve();
    });
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it("report ADHOC-1117-SHIFT-ENTER creates the next cell when an earlier add finishes during save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const firstAdd = deferredValue<string>();
  const save = deferredValue<string>();
  const onAddCell = vi
    .fn()
    .mockReturnValueOnce(firstAdd.promise)
    .mockResolvedValue("new-next-cell");
  const onRunCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, cells: [project.cells[0]!] }}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={() => save.promise}
          onAddCell={onAddCell}
          onDeleteCell={async () => {}}
          onRunCell={onRunCell}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const cell = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(cell);
    await act(async () => {
      cell.focus();
      cell.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
    });
    expect(onAddCell).toHaveBeenCalledTimes(1);
    const editor = cell.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "select 42" },
      });
    });
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await act(async () => {
      firstAdd.resolve("inserted-before");
      await Promise.resolve();
    });
    await act(async () => {
      save.resolve("revision-2");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRunCell).toHaveBeenCalledWith("cel_a");
    expect(onAddCell).toHaveBeenCalledTimes(2);
    expect(onAddCell).toHaveBeenLastCalledWith("sql", "cel_a", undefined);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-CONNECTION-PENDING-LABEL: shows the selected source while saving and rolls back on failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferredValue<string>();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const first = project.cells[0];
    assert(first);
    assert(first.contents.kind === "sql");
    const contents = first.contents;
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{
            ...project,
            cells: [
              {
                ...first,
                contents: { ...contents, dataConnectionId: "demo" },
              },
            ],
          }}
          connections={[{ id: "demo", name: "Demo" }]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={() => pending.promise}
        />,
      ),
    );
    const picker = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Data connection:"]',
    );
    const dataframes = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("Dataframes"));
    assert(picker);
    assert(dataframes);
    await act(async () => dataframes.click());
    expect(picker.getAttribute("aria-label")).toBe(
      "Data connection: Dataframes",
    );
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{
            ...project,
            updatedAt: "other-revision",
            cells: [
              {
                ...first,
                contents: { ...contents, dataConnectionId: "demo" },
              },
            ],
          }}
          connections={[{ id: "demo", name: "Demo" }]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={() => pending.promise}
        />,
      ),
    );
    expect(picker.getAttribute("aria-label")).toBe(
      "Data connection: Dataframes",
    );
    await act(async () => {
      pending.reject(new Error("Save failed"));
    });
    expect(picker.getAttribute("aria-label")).toBe("Data connection: Demo");
    expect(container.textContent).toContain("Save failed");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("acknowledges a Run click and waits for the source save before admission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = deferredValue<string>();
  const admission = deferredValue<boolean>();
  const start = vi.fn(() => admission.promise);
  const onSelectConnection = vi.fn(() => source.promise);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (pending: boolean) =>
    root.render(
      <ProjectEditor
        project={project}
        connections={[{ id: "demo", name: "Demo" }]}
        execution={execution({ start, pending })}
        onRename={async () => {}}
        onSaveCell={async () => {}}
        onAddCell={async () => "test-cell"}
        onDeleteCell={async () => {}}
        onSelectConnection={onSelectConnection}
      />,
    );
  try {
    await act(async () => render(false));
    const cell = container.querySelector('[data-notebook-cell="cel_a"]');
    assert(cell);
    const demo = cell.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Demo"]',
    );
    const run = cell.querySelector<HTMLButtonElement>(".nb-run-button");
    assert(demo);
    assert(run);
    await act(async () => demo.click());
    expect(onSelectConnection).toHaveBeenCalledWith("cel_a", "demo");
    expect(run.disabled).toBe(false);
    await act(async () => run.click());
    expect(
      container.querySelector(".nb-run-all-bar [role=status]")?.textContent,
    ).toBe("Saving…");
    expect(run.disabled).toBe(true);
    expect(start).not.toHaveBeenCalled();
    await act(async () => source.resolve("revision-2"));
    expect(start).toHaveBeenCalledExactlyOnceWith({ cellId: "cel_a" });
    await act(async () => render(true));
    expect(
      container.querySelector(".nb-run-all-bar [role=status]")?.textContent,
    ).toBe("Saving changes…");
    await act(async () => admission.resolve(true));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-PENDING-CONNECTION-RUN: runs and advances when Shift+Enter follows a pending connection selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferredValue<string>();
  const onSaveCell = vi.fn(async () => "revision-3");
  const onSelectConnection = vi.fn(() => pending.promise);
  const onRunCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{
            ...project,
            cells: project.cells.map((cell) => ({
              ...cell,
              updatedAt: "revision-1",
            })),
          }}
          connections={[{ id: "demo", name: "Demo" }]}
          onRename={async () => {}}
          onSaveCell={onSaveCell}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={onRunCell}
          onSelectConnection={onSelectConnection}
        />,
      ),
    );
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(first);
    const demo = [
      ...first.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Demo"));
    assert(demo);
    await act(async () => demo.click());
    expect(onSelectConnection).toHaveBeenCalledWith("cel_a", "demo");
    const editor = first.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "select 42" },
      });
    });
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onRunCell).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve("revision-2");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSaveCell).toHaveBeenCalledTimes(1);
    expect(onSaveCell).toHaveBeenCalledWith(
      "cel_a",
      expect.objectContaining({
        source: "select 42",
        dataConnectionId: "demo",
      }),
      "revision-2",
    );
    expect(onRunCell).toHaveBeenCalledTimes(1);
    expect(onRunCell).toHaveBeenCalledWith("cel_a");
    expect(document.activeElement).toBe(
      container.querySelector('[data-notebook-cell="cel_b"]'),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("shows connection failure and does not run the queued shortcut", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferredValue<string>();
  const onRunCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[{ id: "demo", name: "Demo" }]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={onRunCell}
          onSelectConnection={() => pending.promise}
        />,
      ),
    );
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(first);
    const demo = [
      ...first.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Demo"));
    assert(demo);
    await act(async () => demo.click());
    const editor = first.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await act(async () => {
      pending.reject(new Error("Connection save failed"));
      await Promise.resolve();
    });
    expect(onRunCell).not.toHaveBeenCalled();
    expect(first.textContent).toContain("Connection save failed");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("does not run a queued shortcut after navigating to another project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferredValue<string>();
  const onRunCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (current: ProjectDocument) => (
    <ProjectEditor
      project={current}
      connections={[{ id: "demo", name: "Demo" }]}
      onRename={async () => {}}
      onSaveCell={async () => {}}
      onAddCell={async () => "test-cell"}
      onDeleteCell={async () => {}}
      onRunCell={onRunCell}
      onSelectConnection={() => pending.promise}
    />
  );
  try {
    await act(async () => root.render(render(project)));
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(first);
    const demo = [
      ...first.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Demo"));
    assert(demo);
    await act(async () => demo.click());
    const editor = first.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await act(async () =>
      root.render(render({ ...project, id: "another-project" })),
    );
    await act(async () => {
      pending.resolve("revision-2");
      await Promise.resolve();
    });
    expect(onRunCell).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("waits for an existing autosave before selecting a connection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const pending = deferredValue<string>();
  const onSaveCell = vi.fn(() => pending.promise);
  const onSelectConnection = vi.fn(async () => "revision-3");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[{ id: "demo", name: "Demo" }]}
          onRename={async () => {}}
          onSaveCell={onSaveCell}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={onSelectConnection}
        />,
      ),
    );
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    assert(first);
    const editor = first.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "select 42" },
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(onSaveCell).toHaveBeenCalledTimes(1);
    const demo = [
      ...first.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Demo"));
    assert(demo);
    await act(async () => demo.click());
    expect(onSelectConnection).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve("revision-2");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSelectConnection).toHaveBeenCalledOnce();
    expect(onSelectConnection).toHaveBeenCalledWith("cel_a", "demo");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it("report A2-KEYBOARD-DELETE-BUSY: allows deleting another cell while a single-cell run is finishing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = deferred();
  const onRunCell = vi.fn(() => pending.promise);
  const onDeleteCell = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={onDeleteCell}
          onRunCell={onRunCell}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const first = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_a"]',
    );
    const second = container.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_b"]',
    );
    assert(first);
    assert(second);
    const editor = first.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });
    expect(onRunCell).toHaveBeenCalledWith("cel_a");
    const firstMenu = first.querySelector<HTMLButtonElement>(
      'button[aria-label^="More actions for "]',
    );
    const secondMenu = second.querySelector<HTMLButtonElement>(
      'button[aria-label^="More actions for "]',
    );
    assert(firstMenu);
    assert(secondMenu);
    expect(firstMenu.disabled).toBe(true);
    expect(secondMenu.disabled).toBe(false);
    await act(async () => {
      first.focus();
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
    });
    expect(onDeleteCell).not.toHaveBeenCalled();
    await act(async () => {
      second.focus();
      second.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      second.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(onDeleteCell).toHaveBeenCalledOnce();
    expect(onDeleteCell).toHaveBeenCalledWith("cel_b");
  } finally {
    await act(async () => {
      pending.resolve();
      await Promise.resolve();
    });
    act(() => root.unmount());
    container.remove();
  }
});

it("report A2-DATAFRAME-LABEL-MODE: resolves the default connection while preserving explicit dataframes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const source = deferredValue<string>();
  const onSelectConnection = vi.fn(() => source.promise);
  const start = vi.fn(async () => true);
  try {
    const first = project.cells[0]!;
    if (first.contents.kind !== "sql") throw new Error("Expected SQL cell");
    const explicit = {
      ...first,
      id: "cel_dataframe",
      contents: {
        ...first.contents,
        id: "cel_dataframe",
        connectionMode: "dataframes" as const,
      },
    };
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, cells: [first, explicit] }}
          connections={[{ id: "default", name: "Warehouse", isDefault: true }]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "test-cell"}
          onDeleteCell={async () => {}}
          execution={execution({ start })}
          onSelectConnection={onSelectConnection}
        />,
      ),
    );
    expect(
      container
        .querySelector(
          '[data-notebook-cell="cel_a"] button[aria-label^="Data connection:"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("Data connection: Warehouse");
    expect(
      container
        .querySelector(
          '[data-notebook-cell="cel_dataframe"] button[aria-label^="Data connection:"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("Data connection: Dataframes");
    const legacyRun = container.querySelector<HTMLButtonElement>(
      '[data-notebook-cell="cel_a"] .nb-run-button',
    );
    assert(legacyRun);
    await act(async () => legacyRun.click());
    expect(onSelectConnection).toHaveBeenCalledExactlyOnceWith(
      "cel_a",
      "default",
    );
    expect(start).not.toHaveBeenCalled();
    await act(async () => source.resolve("revision-2"));
    expect(start).toHaveBeenCalledExactlyOnceWith({ cellId: "cel_a" });
    const dataframeRun = container.querySelector<HTMLButtonElement>(
      '[data-notebook-cell="cel_dataframe"] .nb-run-button',
    );
    assert(dataframeRun);
    await act(async () => dataframeRun.click());
    expect(onSelectConnection).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenLastCalledWith({ cellId: "cel_dataframe" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(["click", "keyboard", "run all"])(
  "report A2-INPUT-DRAFT-RUN: %s waits for a pending input save",
  async (mode) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const pending = deferredValue<string>();
    const onSaveCell = vi.fn(() => pending.promise);
    const start = vi.fn(async () => true);
    const inputCell = {
      id: "cel_input",
      contents: {
        ...base,
        id: "cel_input",
        kind: "input" as const,
        order: "a0",
        name: "Choice",
        inputType: "CHECKBOX" as const,
        defaultValueString: "false",
        options: [],
        optional: false,
      },
    };
    const current = {
      ...project,
      cells: [inputCell, sqlCell("cel_a", "a1", "select 1")],
    } as ProjectDocument;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <ProjectEditor
            project={current}
            connections={[]}
            onRename={async () => {}}
            onSaveCell={onSaveCell}
            onAddCell={async () => "new"}
            onDeleteCell={async () => {}}
            execution={execution({ start })}
            onSelectConnection={async () => {}}
          />,
        ),
      );
      const toggle = container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Choice"]',
      );
      assert(toggle);
      const sql = container.querySelector<HTMLElement>(
        '[data-notebook-cell="cel_a"]',
      );
      assert(sql);
      await act(async () => {
        toggle.click();
        if (mode === "run all") {
          const button = [...container.querySelectorAll("button")].find(
            (item) => item.textContent?.trim() === "Run all",
          );
          assert(button);
          button.click();
        } else if (mode === "click") {
          const button = sql.querySelector<HTMLButtonElement>(
            '[data-rid="notebook.cell.run"]',
          );
          assert(button);
          button.click();
        } else {
          const editor = sql.querySelector<HTMLElement>(".cm-content");
          assert(editor);
          editor.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              metaKey: true,
              bubbles: true,
            }),
          );
        }
        await Promise.resolve();
      });
      expect(start).not.toHaveBeenCalled();
      await act(async () => {
        pending.resolve("revision-2");
        await pending.promise;
        await Promise.resolve();
      });
      expect(start).toHaveBeenCalledExactlyOnceWith(
        mode === "run all" ? { all: true } : { cellId: "cel_a" },
      );
      expect(onSaveCell).toHaveBeenCalledOnce();
      expect(onSaveCell).toHaveBeenCalledWith(
        "cel_input",
        expect.objectContaining({ defaultValueString: "true" }),
        undefined,
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it.each(["rejected", "navigated"])(
  "report A2-INPUT-DRAFT-RUN: %s input save prevents the queued run",
  async (outcome) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const pending = deferredValue<string>();
    const start = vi.fn(async () => true);
    const inputCell = {
      id: "cel_input",
      contents: {
        ...base,
        id: "cel_input",
        kind: "input" as const,
        order: "a0",
        name: "Choice",
        inputType: "CHECKBOX" as const,
        defaultValueString: "false",
        options: [],
        optional: false,
      },
    };
    const current = {
      ...project,
      cells: [inputCell, sqlCell("cel_a", "a1", "select 1")],
    } as ProjectDocument;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (document: ProjectDocument) => (
      <ProjectEditor
        project={document}
        connections={[]}
        onRename={async () => {}}
        onSaveCell={() => pending.promise}
        onAddCell={async () => "new"}
        onDeleteCell={async () => {}}
        execution={execution({ start })}
        onSelectConnection={async () => {}}
      />
    );
    try {
      await act(async () => root.render(render(current)));
      const toggle = container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Choice"]',
      );
      assert(toggle);
      await act(async () => toggle.click());
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === "Run all",
      );
      assert(button);
      await act(async () => button.click());
      if (outcome === "navigated")
        await act(async () =>
          root.render(render({ ...current, id: "next-project", cells: [] })),
        );
      await act(async () => {
        if (outcome === "rejected")
          pending.reject(new Error("Input save failed"));
        else pending.resolve("revision-2");
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(start).not.toHaveBeenCalled();
      if (outcome === "rejected")
        expect(container.textContent).toContain("Input save failed");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it("report A2-INPUT-DRAFT-RUN: stale input blocks run and shows the conflict", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const start = vi.fn(async () => true);
  const inputCell = {
    id: "cel_input",
    contents: {
      ...base,
      id: "cel_input",
      kind: "input" as const,
      order: "a0",
      name: "Choice",
      inputType: "TEXT_INPUT" as const,
      defaultValueString: "first",
      options: [],
      optional: false,
    },
  };
  const current = {
    ...project,
    cells: [inputCell, sqlCell("cel_a", "a1", "select 1")],
  } as ProjectDocument;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (document: ProjectDocument) => (
    <ProjectEditor
      project={document}
      connections={[]}
      onRename={async () => {}}
      onSaveCell={async () => {}}
      onAddCell={async () => "new"}
      onDeleteCell={async () => {}}
      execution={execution({ start })}
      onSelectConnection={async () => {}}
    />
  );
  try {
    await act(async () => root.render(render(current)));
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Value for Choice"]',
    );
    assert(input);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setter);
      setter.call(input, "local");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      root.render(
        render({
          ...current,
          cells: [
            {
              ...inputCell,
              contents: { ...inputCell.contents, defaultValueString: "remote" },
            },
            current.cells[1]!,
          ],
        } as ProjectDocument),
      ),
    );
    expect(container.textContent).toContain("Changed elsewhere");
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Run all",
    );
    assert(button);
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(start).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("persists a changed input while a dependent cell is running and leaves scheduling to the server", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onSaveCell = vi.fn(async () => "revision-2");
  const start = vi.fn(async () => true);
  const current = {
    ...project,
    cells: [
      {
        id: "cel_region",
        contents: {
          ...base,
          id: "cel_region",
          kind: "input",
          order: "a0",
          name: "region",
          inputType: "DROPDOWN",
          options: ["east", "west"],
          defaultValueString: "east",
        },
      },
      sqlCell("cel_direct", "a1", "SELECT {{ region }} AS region"),
    ],
  } as ProjectDocument;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectEditor
            project={current}
            connections={[]}
            onRename={async () => {}}
            onSaveCell={onSaveCell}
            onAddCell={async () => "new"}
            onDeleteCell={async () => {}}
            execution={execution({
              start,
              runningIds: new Set(["cel_direct"]),
            })}
            onSelectConnection={async () => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Value for region"]',
    );
    assert(trigger);
    await act(async () => trigger.click());
    const west = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent === "west");
    assert(west);
    await act(async () => west.click());
    expect(onSaveCell).toHaveBeenCalledExactlyOnceWith(
      "cel_region",
      expect.objectContaining({ defaultValueString: "west" }),
      undefined,
    );
    expect(start).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("opens a full-page Agent view while keeping the notebook mounted for drafts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    project,
    connections: [],
    onRename: async () => {},
    onSaveCell: async () => {},
    onAddCell: async () => "new-cell",
    onDeleteCell: async () => {},
    onRunCell: async () => {},
    onSelectConnection: async () => {},
    onSelectView: vi.fn(),
    agentPane: <div>Current conversation</div>,
  };
  try {
    await act(async () =>
      root.render(<ProjectEditor {...props} view="agent" agentOpen />),
    );
    expect(container.querySelector<HTMLElement>(".nb-main-card")?.hidden).toBe(
      true,
    );
    expect(
      container.querySelector(
        '.nb-workbench.is-agent-view [aria-label="Agent"]',
      )?.textContent,
    ).toContain("Current conversation");
    await act(async () =>
      root.render(<ProjectEditor {...props} view="notebook" agentOpen />),
    );
    expect(container.querySelector<HTMLElement>(".nb-main-card")?.hidden).toBe(
      false,
    );
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toContain("Notebook");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report 1794948376: a copied cell link scrolls to and focuses its cell once the notebook has loaded", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  window.history.replaceState(null, "", "#cell-cel_c");
  const props = {
    connections: [],
    onRename: async () => {},
    onSaveCell: async () => {},
    onAddCell: async () => "new-cell",
    onDeleteCell: async () => {},
    onRunCell: async () => {},
    onSelectConnection: async () => {},
  };
  try {
    await act(async () =>
      root.render(
        <ProjectEditor {...props} project={{ ...project, cells: [] }} />,
      ),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () =>
      root.render(<ProjectEditor {...props} project={project} />),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(
      container.querySelector('[data-notebook-cell="cel_c"]'),
    );
    // A later edit to the project must not pull the page back to the link.
    await act(async () =>
      root.render(
        <ProjectEditor {...props} project={{ ...project, title: "Renamed" }} />,
      ),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  } finally {
    window.history.replaceState(null, "", "#");
    await act(async () => root.unmount());
    container.remove();
  }
});

it("a malformed or unmatched copied-link fragment leaves the notebook readable and a project change restores a valid target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Browsers queue and coalesce this event; happy-dom fires it synchronously
  // from Selection.collapse, reentering CodeMirror's selection update.
  const dispatch = document.dispatchEvent.bind(document);
  let selectionEvent: Event | null = null;
  let selectionTask: ReturnType<typeof setTimeout> | null = null;
  const clearSelectionTask = () => {
    if (selectionTask !== null) clearTimeout(selectionTask);
  };
  const selectionDispatch = vi
    .spyOn(document, "dispatchEvent")
    .mockImplementation((event) => {
      if (event.type !== "selectionchange") return dispatch(event);
      selectionEvent = event;
      if (selectionTask === null) {
        selectionTask = setTimeout(() => {
          selectionTask = null;
          const queued = selectionEvent;
          selectionEvent = null;
          if (queued) dispatch(queued);
        }, 0);
      }
      return true;
    });
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const props = {
    connections: [],
    onRename: async () => {},
    onSaveCell: async () => {},
    onAddCell: async () => "new-cell",
    onDeleteCell: async () => {},
    onRunCell: async () => {},
    onSelectConnection: async () => {},
  };
  try {
    for (const fragment of [
      "#cell-%",
      "#cell-%E0%A4%A",
      "#cell-no_such_cell",
    ]) {
      window.history.replaceState(null, "", fragment);
      await act(async () =>
        root.render(<ProjectEditor {...props} project={project} />),
      );
      expect(
        container.querySelector('[data-notebook-cell="cel_c"]'),
      ).not.toBeNull();
      expect(scrollIntoView).not.toHaveBeenCalled();
    }
    // Opening the valid link is a fresh load of the notebook.
    await act(async () => root.unmount());
    window.history.replaceState(null, "", "#cell-cel_c");
    root = createRoot(container);
    await act(async () =>
      root.render(<ProjectEditor {...props} project={project} />),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Opening another project that holds the same cell id restores it again.
    await act(async () =>
      root.render(
        <ProjectEditor {...props} project={{ ...project, id: "prj_other" }} />,
      ),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  } finally {
    window.history.replaceState(null, "", "#");
    await act(async () => root.unmount());
    clearSelectionTask();
    selectionDispatch.mockRestore();
    container.remove();
  }
});

it("a link opened on the same page restores its cell, once, and ignores a malformed one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dispatch = document.dispatchEvent.bind(document);
  const selection: {
    event: Event | null;
    task: ReturnType<typeof setTimeout> | null;
  } = { event: null, task: null };
  vi.spyOn(document, "dispatchEvent").mockImplementation((event) => {
    if (event.type !== "selectionchange") return dispatch(event);
    selection.event = event;
    if (selection.task === null) {
      selection.task = setTimeout(() => {
        selection.task = null;
        const queued = selection.event;
        selection.event = null;
        if (queued) dispatch(queued);
      }, 0);
    }
    return true;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const props = {
    connections: [],
    onRename: async () => {},
    onSaveCell: async () => {},
    onAddCell: async () => "new-cell",
    onDeleteCell: async () => {},
    onRunCell: async () => {},
    onSelectConnection: async () => {},
  };
  const open = async (hash: string) =>
    act(async () => {
      window.history.replaceState(null, "", hash);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  try {
    window.history.replaceState(null, "", "#");
    await act(async () =>
      root.render(<ProjectEditor {...props} project={project} />),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    await open("#cell-cel_a");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(
      container.querySelector('[data-notebook-cell="cel_a"]'),
    );
    await open("#cell-cel_c");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(
      container.querySelector('[data-notebook-cell="cel_c"]'),
    );
    // Malformed, unknown and non-cell fragments leave the page where it is.
    for (const hash of ["#cell-%", "#cell-gone", "#other"]) await open(hash);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    // A later edit does not pull the page back to the link.
    await open("#cell-cel_c");
    await act(async () =>
      root.render(
        <ProjectEditor {...props} project={{ ...project, title: "Renamed" }} />,
      ),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  } finally {
    window.history.replaceState(null, "", "#");
    await act(async () => root.unmount());
    if (selection.task !== null) clearTimeout(selection.task);
    container.remove();
    vi.restoreAllMocks();
  }
});

it("report 1794947464: routed projects offer Agent without a sidebar toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelectView = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, cells: [] }}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "new-cell"}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
          onSelectView={onSelectView}
          view="notebook"
          agentOpen
          agentPane={<div>Current conversation</div>}
        />,
      ),
    );
    const agent = [
      ...container.querySelectorAll<HTMLButtonElement>(".nb-view-tabs button"),
    ].find((tab) => tab.textContent.trim() === "Agent");
    assert(agent);
    await act(async () => agent.click());
    expect(onSelectView).toHaveBeenCalledWith("agent");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps one notebook title and description mounted across the first cell, with title cancellation and retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRename = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Rename unavailable"))
    .mockResolvedValue(undefined);
  const onSaveDescription = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (cells: ProjectDocument["cells"], canEdit = true) =>
    act(async () =>
      root.render(
        <ProjectEditor
          project={{ ...project, cells }}
          canEdit={canEdit}
          connections={[]}
          onRename={onRename}
          onSaveDescription={onSaveDescription}
          onSaveCell={async () => {}}
          onAddCell={async () => "new-cell"}
          onDeleteCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
  const press = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const change = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    assert(setter);
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const descriptionButtons = () =>
    Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Add description...",
    );

  try {
    await render([]);
    const heading = container.querySelector(".nb-body h1");
    assert(heading);
    expect(container.querySelectorAll(".nb-body h1")).toHaveLength(1);
    expect(descriptionButtons()).toHaveLength(1);
    const cell = project.cells[1];
    assert(cell);
    await render([cell]);
    expect(container.querySelectorAll(".nb-body h1")).toHaveLength(1);
    expect(container.querySelector(".nb-body h1")).toBe(heading);
    expect(descriptionButtons()).toHaveLength(1);

    const edit = async () => {
      const button = heading.querySelector("button");
      assert(button);
      await act(async () => button.click());
      const input = heading.querySelector("input");
      assert(input);
      return input;
    };
    const cancelled = await edit();
    await act(async () => {
      change(cancelled, "Cancelled title");
      press(cancelled, "Escape");
    });
    expect(onRename).not.toHaveBeenCalled();

    const submitted = await edit();
    await act(async () => change(submitted, "Updated title"));
    await act(async () => press(submitted, "Enter"));
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Updated title");
    const alert = container.querySelector('[role="alert"]');
    assert(alert);
    expect(alert.textContent).toContain("Rename unavailable");
    const retry = Array.from(alert.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    assert(retry);
    await act(async () => retry.click());
    expect(onRename).toHaveBeenNthCalledWith(2, "Updated title");
    expect(container.querySelector("header")?.textContent).toContain(
      "Updated title",
    );
    expect(heading.textContent).toContain("Updated title");

    await render([cell], false);
    expect(heading.querySelector("button")).toBeNull();
    expect(descriptionButtons()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("jumps directly to the first failed cell from the header", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectEditor
          project={project}
          connections={[]}
          outputs={{
            cel_c: { status: "error", error: "Later failure" },
            cel_a: { status: "error", error: "First failure" },
          }}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "new-cell"}
          onDeleteCell={async () => {}}
          onSelectConnection={async () => {}}
        />,
      ),
    );
    const badge = [
      ...container.querySelectorAll<HTMLButtonElement>("header button"),
    ].find(
      (button) =>
        button.getAttribute("aria-label") === "2 errors" &&
        button.textContent.trim() === "2",
    );
    assert(badge);
    await act(async () => badge.click());
    expect(document.activeElement).toBe(
      container.querySelector('[data-notebook-cell="cel_a"]'),
    );
    expect(badge.getAttribute("aria-haspopup")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
