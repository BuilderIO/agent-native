// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { startCompletion, completionStatus } from "@codemirror/autocomplete";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@uiw/react-codemirror";
import { act, type ComponentProps, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import "./NotebookCell";
import { draftHeadSchema } from "../../../shared/notebook-snapshot-contract";
import { consumeInputConfigRequest } from "./input-config-request";
import { ProjectEditor as View } from "./ProjectEditor";
import type { NotebookRunIntent } from "./useNotebookRun";

function ProjectEditor(props: ComponentProps<typeof View>) {
  const [client] = useState(() => new QueryClient());
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <View {...props} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const versionActions = vi.hoisted(() => ({
  owner: null as string | null,
  snapshot: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: versionActions.owner ? { email: versionActions.owner } : null,
  }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
const dataBrowser = vi.hoisted(() => ({
  formatSql: vi.fn(),
  datasets: undefined as object | undefined,
  preferences: vi.fn(),
  setPreferences: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (action: string, ...args: unknown[]) =>
    action === "get-notebook-snapshot"
      ? versionActions.snapshot(...args)
      : action === "set-editor-preferences"
        ? dataBrowser.setPreferences(...args)
        : dataBrowser.formatSql(action, ...args),
  useActionMutation: () => ({ mutateAsync: versionActions.save }),
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  actionErrorCode: (error: { errorCode?: string }) => error.errorCode,
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: (name: string) => ({
    data:
      name === "list-connection-datasets"
        ? dataBrowser.datasets
        : name === "get-editor-preferences"
          ? dataBrowser.preferences()
          : undefined,
    refetch: async () => ({ data: dataBrowser.preferences() }),
    isPending: false,
    error: null,
  }),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

const empty: ProjectDocument = {
  id: "prj_focus",
  title: "Focus project",
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
  cells: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
};
const added: ProjectDocument["cells"][number] = {
  id: "cel_new",
  projectId: empty.id,
  versionId: empty.workingVersionId,
  createdAt: empty.createdAt,
  updatedAt: empty.updatedAt,
  contents: {
    id: "cel_new",
    kind: "sql",
    order: "a1",
    source: "",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  },
};

it("checkpoints the final keystroke only after the draft save commits", async () => {
  const initial = draftHeadSchema.parse({
    versionId: empty.workingVersionId,
    revision: "1",
  });
  const accepted = draftHeadSchema.parse({ ...initial, revision: "2" });
  let acknowledge: ((revision: string) => void) | undefined;
  const write = new Promise<string>((resolve) => {
    acknowledge = resolve;
  });
  const save = vi.fn(() => write);
  versionActions.owner = empty.ownerEmail;
  versionActions.snapshot.mockResolvedValue({
    status: "accepted",
    snapshot: { head: accepted },
  });
  versionActions.save.mockResolvedValue({});
  try {
    await checkEditor(
      {
        project: { ...empty, draftHead: initial, cells: [added] },
        onSaveCell: save,
      },
      async (host) => {
        const editor = host.querySelector<HTMLElement>(".cm-content");
        assert(editor);
        const view = EditorView.findFromDOM(editor);
        assert(view);
        const lastKeystroke = "SELECT 42 AS checkpoint_value";
        await act(async () => {
          view.dispatch({ changes: { from: 0, insert: lastKeystroke } });
          editor.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "s",
              metaKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        const dialog = document.querySelector('[role="dialog"]');
        const name = dialog?.querySelector<HTMLInputElement>(
          'input[placeholder="What\'s new?"]',
        );
        const form = dialog?.querySelector("form");
        assert(name && form);
        await act(async () => {
          const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          assert(setValue);
          setValue.call(name, "Quarterly review");
          name.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () =>
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
        expect(save).toHaveBeenCalledWith(
          added.id,
          { ...added.contents, source: lastKeystroke },
          added.updatedAt,
          undefined,
          true,
        );
        expect(versionActions.snapshot).not.toHaveBeenCalled();
        expect(versionActions.save).not.toHaveBeenCalled();
        await act(async () => {
          assert(acknowledge);
          acknowledge("2026-11-01T00:00:01.000Z");
        });
        expect(versionActions.save).toHaveBeenCalledExactlyOnceWith({
          projectId: empty.id,
          name: "Quarterly review",
          observedHead: accepted,
          opId: expect.any(String),
        });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      },
    );
  } finally {
    versionActions.owner = null;
    versionActions.snapshot.mockReset();
    versionActions.save.mockReset();
  }
});

it("opens Save a version on Ctrl+S from focus outside the notebook, only for the owner", async () => {
  const head = draftHeadSchema.parse({
    versionId: empty.workingVersionId,
    revision: "1",
  });
  const press = () => {
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event;
  };
  try {
    versionActions.owner = empty.ownerEmail;
    await checkEditor(
      { project: { ...empty, draftHead: head, cells: [added] } },
      async () => {
        let event: KeyboardEvent | undefined;
        await act(async () => {
          event = press();
        });
        expect(event?.defaultPrevented).toBe(true);
        expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
          "Save a version",
        );
      },
    );
    versionActions.owner = "someone-else@example.test";
    await checkEditor(
      { project: { ...empty, draftHead: head, cells: [added] } },
      async () => {
        let event: KeyboardEvent | undefined;
        await act(async () => {
          event = press();
        });
        expect(event?.defaultPrevented).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      },
    );
  } finally {
    versionActions.owner = null;
  }
});

it("opens Save a version on s in command mode, only for the owner and never while typing", async () => {
  const head = draftHeadSchema.parse({
    versionId: empty.workingVersionId,
    revision: "1",
  });
  const press = (target: Element) => {
    const event = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const commandCell = () => {
    const cell = document.querySelector<HTMLElement>("[data-notebook-cell]");
    assert(cell);
    return cell;
  };
  try {
    versionActions.owner = empty.ownerEmail;
    await checkEditor(
      { project: { ...empty, draftHead: head, cells: [added] } },
      async () => {
        let event: KeyboardEvent | undefined;
        await act(async () => {
          event = press(commandCell());
        });
        expect(event?.defaultPrevented).toBe(true);
        expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
          "Save a version",
        );
      },
    );
    await checkEditor(
      { project: { ...empty, draftHead: head, cells: [added] } },
      async () => {
        const field = document.querySelector<HTMLElement>(
          "[data-notebook-cell] .cm-content, [data-notebook-cell] input, [data-notebook-cell] textarea",
        );
        assert(field);
        let event: KeyboardEvent | undefined;
        await act(async () => {
          event = press(field);
        });
        expect(event?.defaultPrevented).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      },
    );
    versionActions.owner = "someone-else@example.test";
    await checkEditor(
      { project: { ...empty, draftHead: head, cells: [added] } },
      async () => {
        let event: KeyboardEvent | undefined;
        await act(async () => {
          event = press(commandCell());
        });
        expect(event?.defaultPrevented).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      },
    );
  } finally {
    versionActions.owner = null;
  }
});

it("shows a legacy SQL input name and saves a repaired name from Rename cell", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const contents = {
    id: added.id,
    order: "a1",
    kind: "input" as const,
    label: "Channel",
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    name: "Input 1",
    inputType: "TEXT_INPUT" as const,
    defaultValueString: "partner",
  };
  const save = vi.fn(async () => {});
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectEditor
            project={{ ...empty, cells: [{ ...added, contents }] }}
            connections={[]}
            onRename={async () => {}}
            onSaveCell={save}
            onAddCell={async () => added.id}
            onDeleteCell={async () => {}}
            onRunCell={async () => {}}
            onSelectConnection={async () => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const title = container.querySelector(".nb-cell-title");
    expect(title?.textContent).toBe("Input 1");
    expect(container.textContent).toContain(
      "Rename this input to use it in SQL.",
    );
    const rename = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rename cell: Input 1"]',
    );
    assert(rename);
    await act(async () => rename.click());
    const field = container.querySelector<HTMLInputElement>(
      ".nb-cell-title-input",
    );
    assert(field);
    expect(field.value).toBe("Input 1");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setValue);
      setValue.call(field, "channel_pick");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => field.blur());
    expect(save).toHaveBeenCalledWith(added.id, {
      ...contents,
      name: "channel_pick",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("report NOTEBOOK01 focuses the SQL editor after adding a query to an empty notebook", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Notebook() {
    const [project, setProject] = useState(empty);
    return (
      <ProjectEditor
        project={project}
        connections={[]}
        onRename={async () => {}}
        onSaveCell={async () => {}}
        onAddCell={async () => {
          setProject((current) => ({ ...current, cells: [added] }));
          return added.id;
        }}
        onDeleteCell={async () => {}}
        onRunCell={async () => {}}
        onSelectConnection={async () => {}}
      />
    );
  }
  try {
    await act(async () => root.render(<Notebook />));
    const query = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Query",
    );
    assert(query);
    await act(async () => {
      query.focus();
      query.click();
    });
    const editor = container.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    expect(document.activeElement).toBe(editor);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("opens a newly added text cell ready to type", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const text: ProjectDocument["cells"][number] = {
    ...added,
    contents: {
      id: added.id,
      kind: "text",
      order: "a1",
      text: "",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    },
  };
  function Notebook() {
    const [project, setProject] = useState(empty);
    return (
      <ProjectEditor
        project={project}
        connections={[]}
        onRename={async () => {}}
        onSaveCell={async () => {}}
        onAddCell={async () => {
          setProject((current) => ({ ...current, cells: [text] }));
          return text.id;
        }}
        onDeleteCell={async () => {}}
        onRunCell={async () => {}}
        onSelectConnection={async () => {}}
      />
    );
  }
  try {
    await act(async () => root.render(<Notebook />));
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Text",
    );
    assert(button);
    await act(async () => button.click());
    const editor = container.querySelector<HTMLTextAreaElement>(
      `[data-notebook-cell="${text.id}"] textarea`,
    );
    assert(editor);
    expect(document.activeElement).toBe(editor);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a numeric edit focused through the add-cell receipt and menu focus restoration", async () => {
  let acknowledge: ((cellId: string) => void) | undefined;
  const receipt = new Promise<string>((resolve) => {
    acknowledge = resolve;
  });
  const save = vi.fn(async () => "revision-2");
  const inputCell: ProjectDocument["cells"][number] = {
    ...added,
    id: "cel_numeric",
    contents: {
      id: "cel_numeric",
      order: "a2",
      kind: "input",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      name: "amount",
      inputType: "NUMERIC_INPUT",
      defaultValueString: "0",
    },
  };
  const project = { ...empty, cells: [added] };
  await checkEditor(
    { project, onAddCell: () => receipt, onSaveCell: save },
    async (host, render) => {
      const inputs = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Inputs",
      );
      assert(inputs);
      await act(async () => {
        inputs.focus();
        inputs.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      const number = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.trim() === "Number input");
      assert(number);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await act(async () => number.click());
        await render({ project: { ...project, cells: [added, inputCell] } });
        const field = host.querySelector<HTMLInputElement>(
          'input[type="number"]',
        );
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        assert(field && setValue);
        await act(async () => {
          field.focus();
          setValue.call(field, "7");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const accept = acknowledge;
        assert(accept);
        await act(async () => accept(inputCell.id));
        await act(async () => vi.advanceTimersByTimeAsync(249));
        expect(document.activeElement).toBe(field);
        expect(save).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(save).toHaveBeenCalledExactlyOnceWith(
          inputCell.id,
          expect.objectContaining({ defaultValueString: "7" }),
          inputCell.updatedAt,
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

it.each(["inserted editor", "other control"])(
  "report A2-NEW-SQL-CELL-FOCUS preserves focus on %s after Shift+Enter",
  async (target) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const dispatch = document.dispatchEvent.bind(document);
    vi.spyOn(document, "dispatchEvent").mockImplementation((event) =>
      event.type === "selectionchange" ? true : dispatch(event),
    );
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      function (this: HTMLElement) {
        return (this.matches(".cm-content")
          ? [{ width: 100, height: 20 }]
          : []) as unknown as DOMRectList;
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const other = document.createElement("button");
    document.body.append(other);
    const root = createRoot(container);
    const first = {
      ...added,
      id: "first",
      contents: { ...added.contents, id: "first", order: "a0" },
    };
    function Notebook() {
      const [project, setProject] = useState({ ...empty, cells: [first] });
      return (
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => {
            setProject((current) => ({ ...current, cells: [first, added] }));
            return added.id;
          }}
          onDeleteCell={async () => {}}
          onRunCell={async () => {}}
          onSelectConnection={async () => {}}
        />
      );
    }
    try {
      await act(async () => root.render(<Notebook />));
      const editor = container.querySelector<HTMLElement>(
        '[data-notebook-cell="first"] .cm-content',
      );
      assert(editor);
      await act(async () => {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            shiftKey: true,
            bubbles: true,
          }),
        );
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      if (target === "other control") other.focus();
      await act(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
      const next = container.querySelector<HTMLElement>(
        '[data-notebook-cell="cel_new"] .cm-content',
      );
      assert(next);
      expect(document.activeElement).toBe(
        target === "other control" ? other : next,
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      other.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);

async function checkEditor(
  props: Partial<React.ComponentProps<typeof ProjectEditor>>,
  check: (
    host: HTMLElement,
    render: (
      updates?: Partial<React.ComponentProps<typeof ProjectEditor>>,
    ) => Promise<void>,
  ) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async (updates = {}) => {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectEditor
            project={{ ...empty, cells: [added] }}
            connections={[]}
            onRename={async () => {}}
            onSaveCell={async () => {}}
            onAddCell={async () => added.id}
            onDeleteCell={async () => {}}
            onRunCell={async () => {}}
            onSelectConnection={async () => {}}
            {...props}
            {...updates}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  };
  try {
    await render();
    await check(host, render);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it("opens notebook undo and redo in command mode and leaves editor text undo alone", async () => {
  const undo = vi.fn(async (_redo: boolean) => {});
  await checkEditor({ onUndoCellEdit: undo }, async (host) => {
    const cell = host.querySelector<HTMLElement>("[data-notebook-cell]");
    const editor = host.querySelector<HTMLElement>(".cm-content");
    assert(cell);
    assert(editor);
    const press = (target: HTMLElement, shiftKey = false) =>
      act(async () =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: shiftKey ? "Z" : "z",
            metaKey: true,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await press(editor);
    expect(undo).not.toHaveBeenCalled();
    await press(cell);
    await press(document.body, true);
    expect(undo.mock.calls).toEqual([[false]]);
    await press(cell, true);
    expect(undo.mock.calls).toEqual([[false], [true]]);
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(undo.mock.calls).toEqual([[false], [true]]);
    await act(async () =>
      cell.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(undo.mock.calls).toEqual([[false], [true], [false]]);
  });
});

it("has only one editable description in an empty notebook", async () => {
  await checkEditor(
    { project: empty, onSaveDescription: async () => {} },
    async (host) => {
      expect(
        [...host.querySelectorAll("button")].filter(
          (button) => button.textContent === "Add description...",
        ),
      ).toHaveLength(1);
    },
  );
});

it("closes active CodeMirror SQL suggestions on Escape and Run", async () => {
  const run = vi.fn(async () => {});
  const cell = { ...added, contents: { ...added.contents, source: "select " } };
  await checkEditor(
    { project: { ...empty, cells: [cell] }, onRunCell: run },
    async (host) => {
      const node = host.querySelector<HTMLElement>(".cm-editor");
      assert(node);
      const view = EditorView.findFromDOM(node);
      assert(view);
      const openCompletion = async () => {
        await act(async () => {
          startCompletion(view);
          view.requestMeasure = () => {};
        });
        await vi.waitFor(() =>
          expect(completionStatus(view.state)).toBe("active"),
        );
      };
      await act(async () => view.focus());
      await openCompletion();
      await act(async () =>
        view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(completionStatus(view.state)).toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);
      const press = (target: HTMLElement, key: string) =>
        act(async () =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      await press(view.contentDOM, "Escape");
      const article = host.querySelector<HTMLElement>("[data-notebook-cell]");
      assert(article);
      expect(document.activeElement).toBe(article);
      vi.spyOn(view.contentDOM, "getClientRects").mockReturnValue([
        { width: 100 },
      ] as unknown as DOMRectList);
      await press(article, "Enter");
      expect(document.activeElement).toBe(view.contentDOM);

      await openCompletion();
      const button = host.querySelector<HTMLButtonElement>(
        '[data-rid="notebook.cell.run"]',
      );
      assert(button);
      expect(button.getAttribute("aria-label")).toBe("Run SQL 1");
      await act(async () => button.click());
      expect(run).toHaveBeenCalledWith(cell.id);
      expect(completionStatus(view.state)).toBeNull();
    },
  );
});

it("offers linked SQL and chart cells on the dataframe pill", async () => {
  const cell = {
    ...added,
    contents: { ...added.contents, resultVariable: "orders" },
  };
  const add = vi.fn(async () => "new");
  await checkEditor(
    {
      project: { ...empty, cells: [cell] },
      supportedAddKinds: ["sql", "chart"],
      onAddCell: add,
      outputs: {
        [cell.id]: {
          status: "complete",
          output: {
            type: "table",
            columns: [{ name: "amount", type: "number" }],
            rows: [[42]],
            rowCount: 1,
            truncated: false,
          },
        },
      },
    },
    async (host) => {
      const pill = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "orders",
      );
      assert(pill);
      for (const [label, kind] of [
        ["Visualize in chart", "chart"],
        ["Query with SQL", "sql"],
      ]) {
        await act(async () =>
          pill.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
        );
        const item = [
          ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ].find((el) => el.textContent === label);
        assert(item);
        await act(async () => item.click());
        expect(add).toHaveBeenLastCalledWith(kind, cell.id, {
          dataframe: "orders",
        });
      }
    },
  );
});

it("shows the stored dataframe SQL failure once after a failed run", async () => {
  const message =
    "Run a supported sample SQL cell before querying its dataframe.";
  const run = vi.fn(async () => {
    throw Object.assign(new Error(message), {
      errorCode: "project_dataframes_unavailable",
    });
  });
  await checkEditor(
    {
      onRunCell: run,
      outputs: {
        [added.id]: {
          status: "error",
          output: { type: "error", message, detail: null },
        },
      },
    },
    async (host) => {
      const button = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Run SQL 1"]',
      );
      assert(button);
      await act(async () => button.click());
      expect(run).toHaveBeenCalledWith(added.id);
      expect(host.textContent?.split(message)).toHaveLength(2);
    },
  );
});

it("shows the source loading state until the workspace default is known", async () => {
  const cell = {
    ...added,
    contents: { ...added.contents, dataConnectionId: null },
  };
  await checkEditor(
    {
      project: { ...empty, cells: [cell] },
      connections: [],
      connectionsLoading: true,
    },
    async (host) => {
      expect(
        host.querySelector(".nb-connection")?.getAttribute("aria-busy"),
      ).toBe("true");
      expect(
        host.querySelector(".nb-connection")?.getAttribute("aria-label"),
      ).not.toContain("Select a source");
    },
  );
});

it("admits a catalog query once and scrolls to its cell after it mounts", async () => {
  const table = {
    connectionId: "sample",
    tableId: "table:sample:PUBLIC:orders",
  };
  dataBrowser.datasets = {
    items: [
      { id: table.tableId, name: "orders", kind: "table", hasChildren: false },
    ],
    endCursor: null,
    hasNextPage: false,
  };
  const saved = "saved-query-cell";
  const savedCell = {
    ...added,
    id: saved,
    contents: { ...added.contents, id: saved, order: "a2" },
  };
  const add = vi.fn(async () => saved);
  const run = vi.fn(async (_intent: NotebookRunIntent) => true);
  let finishAdmission: ((cellId: string) => void) | undefined;
  const admission = new Promise<string>((resolve) => {
    finishAdmission = resolve;
  });
  const queryCatalog = vi.fn(() => admission);
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  try {
    await checkEditor(
      {
        connections: [{ id: table.connectionId, name: "Demo" }],
        onAddCell: add,
        onQueryTable: queryCatalog,
        execution: {
          ready: true,
          cells: undefined,
          defaultMode: "auto",
          autoRerun: true,
          run: null,
          runningIds: new Set(),
          pending: false,
          stopping: false,
          start: run,
          cancel: async () => {},
          setSettings: async () => {},
        },
      },
      async (host, render) => {
        const browser = host.querySelector<HTMLButtonElement>(
          'button[aria-label="Data browser"]',
        );
        assert(browser);
        await act(async () => browser.click());
        const query = host.querySelector<HTMLButtonElement>(
          'button[aria-label="Query orders"]',
        );
        assert(query);
        await act(async () => query.click());
        expect(query.disabled).toBe(true);
        await act(async () => query.click());
        expect(queryCatalog).toHaveBeenCalledExactlyOnceWith(table);
        expect(add).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        await act(async () => finishAdmission?.(saved));
        expect(scroll).not.toHaveBeenCalled();
        await render({ project: { ...empty, cells: [added, savedCell] } });
        const inserted = host.querySelector(`[data-notebook-cell="${saved}"]`);
        assert(inserted);
        expect(scroll.mock.contexts).toContain(inserted);
      },
    );
  } finally {
    scroll.mockRestore();
    dataBrowser.datasets = undefined;
  }
});

it("opens the focused gap with Option+A and inserts each backed kind at that anchor", async () => {
  const second = {
    ...added,
    id: "cel_second",
    contents: { ...added.contents, id: "cel_second", order: "a2" },
  };
  const onAddCell = vi.fn(async () => "cel_inserted");
  await checkEditor(
    { project: { ...empty, cells: [added, second] }, onAddCell },
    async (host) => {
      const article = host.querySelector<HTMLElement>(
        '[data-notebook-cell="cel_new"]',
      );
      assert(article);
      const slot = article.closest(".nb-cell-slot");
      assert(slot);
      const press = (
        target: Element,
        key: string,
        code?: string,
        altKey = false,
      ) =>
        act(async () =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              code: code ?? "",
              altKey,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      for (const [key, kind] of [
        ["q", "sql"],
        ["w", "code"],
        ["e", "text"],
        ["n", "markdown"],
        ["r", "chart"],
        ["v", "pivot"],
        ["u", "metric"],
        ["t", "display-table"],
      ] as const) {
        const gap = slot.querySelector("button.nb-insert-button");
        expect(gap?.getAttribute("aria-keyshortcuts")).toBe("Alt+A");
        await act(async () => article.focus());
        await press(article, "å", "KeyA", true);
        const bar = slot.querySelector(".nb-add-surface");
        assert(bar);
        expect(bar.textContent).toContain("Single value");
        expect(bar.textContent.indexOf("Pivot")).toBeLessThan(
          bar.textContent.indexOf("Single value"),
        );
        expect(bar.textContent).toContain("Table");
        const focused = document.activeElement;
        assert(focused);
        expect(bar.contains(focused)).toBe(true);
        expect(onAddCell.mock.calls).toHaveLength(0);
        await press(focused, key, `Key${key.toUpperCase()}`);
        expect(onAddCell).toHaveBeenCalledExactlyOnceWith(
          kind,
          added.id,
          undefined,
        );
        onAddCell.mockClear();
      }
    },
  );
});

it("anchors A and B, runs FF and FS on the focused cell, and advances selection after DD", async () => {
  const project = {
    ...empty,
    cells: [
      { ...added, contents: { ...added.contents, source: "SELECT 1" } },
      {
        ...added,
        id: "cel_next",
        contents: { ...added.contents, id: "cel_next", order: "a2" },
      },
    ],
  };
  const onAddCell = vi.fn(async () => "cel_inserted");
  const onDeleteCell = vi.fn(async () => {});
  dataBrowser.formatSql.mockResolvedValueOnce({ formattedSource: "select 1" });
  await checkEditor({ project, onAddCell, onDeleteCell }, async (host) => {
    const cell = host.querySelector<HTMLElement>(
      '[data-notebook-cell="cel_new"]',
    );
    assert(cell);
    const press = (key: string, target: Element = cell) =>
      act(async () =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await act(async () => cell.focus());
    expect(cell.classList.contains("is-selected")).toBe(true);
    await act(async () => cell.blur());
    expect(document.activeElement).not.toBe(cell);
    expect(cell.classList.contains("is-selected")).toBe(true);
    await act(async () => cell.focus());
    await press("a");
    expect(onAddCell).toHaveBeenCalledTimes(1);
    await act(async () => cell.focus());
    await press("b");
    expect(onAddCell.mock.calls).toEqual([
      ["sql", undefined, { beforeCellId: added.id }],
      ["sql", added.id, undefined],
    ]);
    expect(onDeleteCell).not.toHaveBeenCalled();
    await act(async () => cell.focus());
    await press("f");
    await press("f");
    // oracle-change: Full screen is the cell menu's in-page overlay, not the browser Fullscreen API
    expect(cell.classList.contains("is-fullscreen")).toBe(true);
    await press("f");
    await press("s");
    expect(dataBrowser.formatSql).toHaveBeenCalledWith("format-notebook-sql", {
      projectId: project.id,
      cellId: added.id,
      source: "SELECT 1",
    });
    expect(cell.querySelector(".cm-content")?.textContent).toBe("select 1");
    await press("d");
    expect(onDeleteCell).not.toHaveBeenCalled();
    await press("d");
    expect(onDeleteCell).toHaveBeenCalledExactlyOnceWith(added.id);
    expect(document.activeElement?.getAttribute("data-notebook-cell")).toBe(
      "cel_next",
    );
    expect(cell.classList.contains("is-selected")).toBe(false);
    expect(document.activeElement?.classList.contains("is-selected")).toBe(
      true,
    );
  });
});

it("renumbers mixed-kind default titles by position while retaining variables and custom labels", async () => {
  const first = {
    ...added,
    contents: { ...added.contents, resultVariable: "dataframe" },
  };
  const second = {
    ...added,
    id: "cel_code",
    contents: {
      ...added.contents,
      id: "cel_code",
      kind: "code" as const,
      order: "a2",
      language: "python" as const,
      source: "",
      resultVariable: null,
      outputResult: true,
    },
  };
  const custom = {
    ...added,
    id: "cel_custom",
    contents: {
      ...added.contents,
      id: "cel_custom",
      order: "a3",
      label: "Custom title",
      resultVariable: "sales",
    },
  };
  await checkEditor(
    {
      project: { ...empty, cells: [first, second, custom] },
      outputs: {
        [first.id]: {
          status: "complete",
          output: {
            type: "table",
            columns: [],
            rows: [],
            rowCount: 0,
            truncated: false,
          },
        },
      },
    },
    async (host, render) => {
      const titles = () =>
        [...host.querySelectorAll("[data-notebook-cell] .nb-cell-title")].map(
          (title) => title.textContent,
        );
      expect(titles()).toEqual(["SQL 1", "Code 2", "Custom title"]);
      await render({
        project: {
          ...empty,
          cells: [
            { ...first, contents: { ...first.contents, order: "a2" } },
            { ...second, contents: { ...second.contents, order: "a1" } },
            custom,
          ],
        },
      });
      expect(titles()).toEqual(["Code 1", "SQL 2", "Custom title"]);
      expect(
        host.querySelector(".nb-result-footer .nb-result-variable-name")
          ?.textContent,
      ).toBe("dataframe");
    },
  );
});

it("report QA-1795071219: adding a new input cell opens its configuration settings on creation", async () => {
  const inputCell: ProjectDocument["cells"][number] = {
    ...added,
    id: "cel_input_new",
    contents: {
      id: "cel_input_new",
      order: "a1",
      kind: "input",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      name: "input_1",
      inputType: "TEXT_INPUT",
      defaultValueString: "",
    },
  };
  let renderEditor:
    | ((next: Partial<ComponentProps<typeof View>>) => Promise<void>)
    | null = null;
  await checkEditor(
    {
      project: empty,
      onAddCell: async () => {
        await renderEditor?.({ project: { ...empty, cells: [inputCell] } });
        return inputCell.id;
      },
    },
    async (host, render) => {
      renderEditor = render;
      consumeInputConfigRequest(inputCell.id);
      const inputsButton = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Inputs",
      );
      assert.ok(inputsButton, "Inputs button is rendered");
      await act(async () => {
        inputsButton.focus();
        inputsButton.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      const textInputItem = [
        ...document.querySelectorAll('[role="menuitem"]'),
      ].find((item) => item.textContent?.trim() === "Text input");
      assert.ok(textInputItem, "Text input menu item is rendered");
      await act(async () => {
        (textInputItem as HTMLElement).click();
      });
      const nameInput = document.querySelector<HTMLInputElement>(
        'input[aria-label="Name"], input[name="name"]',
      );
      const popoverName = [...document.querySelectorAll("label")].find(
        (label) => label.textContent?.trim() === "Name",
      );
      expect(Boolean(nameInput || popoverName)).toBe(true);
    },
  );
});

it("uses the signed-in user's saved Markdown choice in another project", async () => {
  versionActions.owner = empty.ownerEmail;
  const defaults = { lineNumbers: true, fullWidthCells: true } as const;
  dataBrowser.preferences.mockReturnValue(defaults);
  dataBrowser.setPreferences.mockImplementation(async (patch) => {
    const saved = { ...defaults, ...patch };
    dataBrowser.preferences.mockReturnValue(saved);
    return saved;
  });
  const onAddCell = vi.fn(async () => "created");
  try {
    await checkEditor(
      { project: { ...empty, cells: [added] }, onAddCell },
      async (host) => {
        const split = [
          ...host.querySelectorAll<HTMLButtonElement>(
            'button[aria-label="Text options"]',
          ),
        ].at(-1);
        assert(split);
        await act(async () =>
          split.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
        );
        const markdown = document.querySelector<HTMLElement>(
          '[role="menuitem"][aria-label="Markdown"]',
        );
        assert(markdown);
        await act(async () => markdown.click());
        expect(dataBrowser.setPreferences).toHaveBeenCalledExactlyOnceWith({
          addTextKind: "markdown",
        });
        expect(onAddCell).toHaveBeenCalledExactlyOnceWith(
          "markdown",
          undefined,
          undefined,
        );
      },
    );
    await checkEditor(
      { project: { ...empty, id: "prj_next", cells: [added] } },
      async (host) => {
        const choice = [...host.querySelectorAll(".nb-add-button")].find(
          (button) => button.textContent === "Markdown",
        );
        assert(choice);
      },
    );
  } finally {
    versionActions.owner = null;
    dataBrowser.preferences.mockReset();
    dataBrowser.setPreferences.mockReset();
  }
});

it("keeps the SQL insert anchored to the gap that opened Data", async () => {
  const onAddCell = vi.fn(async () => "created");
  const second = {
    ...added,
    id: "cel_after",
    contents: { ...added.contents, id: "cel_after", order: "a2" },
  };
  await checkEditor(
    {
      project: { ...empty, cells: [added, second] },
      connections: [{ id: "sample", name: "Demo" }],
      onAddCell,
    },
    async (host) => {
      const slot = host
        .querySelector('[data-notebook-cell="cel_new"]')
        ?.closest(".nb-cell-slot");
      const gap = slot?.querySelector<HTMLButtonElement>(".nb-insert-button");
      assert(gap);
      await act(async () => gap.click());
      const data = [
        ...(slot?.querySelectorAll<HTMLButtonElement>(".nb-add-button") ?? []),
      ].find((button) => button.textContent === "Data");
      assert(data);
      await act(async () => data.click());
      const panel = host.querySelector('aside[aria-label="Data browser"]');
      assert(panel);
      const query = [
        ...panel.querySelectorAll<HTMLButtonElement>("button"),
      ].find(
        (button) => button.textContent === enUS.dataBrowser.notebook.query,
      );
      assert(query);
      await act(async () => query.click());
      expect(onAddCell).toHaveBeenCalledExactlyOnceWith("sql", added.id, {
        dataConnectionId: "sample",
      });
    },
  );
});

it("keeps focus on the cell when command delete fails instead of jumping to sibling", async () => {
  const second = {
    ...added,
    id: "cel_second",
    contents: { ...added.contents, id: "cel_second", order: "a2" },
  };
  let rejectDelete!: (error: Error) => void;
  const onDeleteCell = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      }),
  );
  await checkEditor(
    {
      project: { ...empty, cells: [added, second] },
      onDeleteCell,
    },
    async (host) => {
      const firstCell = host.querySelector<HTMLElement>(
        `[data-notebook-cell="${added.id}"]`,
      );
      assert(firstCell);
      firstCell.focus();
      expect(document.activeElement).toBe(firstCell);
      await act(async () => {
        firstCell.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", bubbles: true }),
        );
        firstCell.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", bubbles: true }),
        );
      });
      expect(onDeleteCell).toHaveBeenCalledWith(added.id);
      await act(async () => {
        rejectDelete(new Error("delete blocked"));
      });
      expect(document.activeElement).toBe(firstCell);
    },
  );
});

it("triggers command-mode undo when focus is on an inner non-input element of a cell", async () => {
  const onUndoCellEdit = vi.fn(async () => {});
  await checkEditor(
    {
      project: { ...empty, cells: [added] },
      onUndoCellEdit,
    },
    async (host) => {
      const cellEl = host.querySelector<HTMLElement>(
        `[data-notebook-cell="${added.id}"]`,
      );
      const innerBtn = cellEl?.querySelector<HTMLButtonElement>("button");
      assert(cellEl && innerBtn);
      innerBtn.focus();
      expect(document.activeElement).toBe(innerBtn);
      await act(async () => {
        innerBtn.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            code: "KeyZ",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(onUndoCellEdit).toHaveBeenCalledWith(false);
    },
  );
});
