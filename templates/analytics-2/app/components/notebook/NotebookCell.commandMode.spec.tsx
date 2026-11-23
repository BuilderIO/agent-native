// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const cell: Cell = {
  id: "cell",
  projectId: "project",
  versionId: "version",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  contents: {
    id: "cell",
    order: "a",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "sql",
    source: "SELECT 1",
    dataConnectionId: "connection",
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  },
};

async function mount(overrides?: { cell?: Cell; draftText?: string }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls = {
    run: vi.fn(),
    addBelow: vi.fn(),
    runAndAdvance: vi.fn(),
    saveContents: vi.fn(),
    deleteCell: vi.fn(),
    commandDelete: vi.fn(),
  };
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <NotebookCell
          cell={overrides?.cell ?? cell}
          title="SQL 1"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId="connection"
          draftText={overrides?.draftText ?? "SELECT 1"}
          dirty={false}
          stale={false}
          outputState={undefined}
          error={null}
          onTextChange={() => {}}
          onSaveDraft={() => {}}
          onSaveContents={calls.saveContents}
          onRun={calls.run}
          onRunAndAdvance={calls.runAndAdvance}
          onAddBelow={calls.addBelow}
          onDiscard={() => {}}
          onOverwrite={() => {}}
          onDelete={calls.deleteCell}
          onCommandDelete={calls.commandDelete}
          onSelectConnection={() => {}}
          onDismissError={() => {}}
          onRetryError={() => {}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const close = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, calls, close };
}

const press = (target: Element, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });

it("report A2-FIND-20261116-F11 Escape from the SQL editor selects the cell so command keys act on it", async () => {
  const { host, calls, close } = await mount();
  try {
    const article = host.querySelector<HTMLElement>("article");
    const editor = host.querySelector<HTMLElement>(".cm-content");
    assert(article);
    assert(editor);
    await act(async () => editor.focus());
    expect(document.activeElement).toBe(editor);
    await press(editor, { key: "Escape" });
    expect(document.activeElement).toBe(article);
    await press(document.activeElement as Element, { key: "b", code: "KeyB" });
    expect(calls.addBelow).toHaveBeenCalledTimes(1);
  } finally {
    await close();
  }
});

it("report A2-FIND-20261116-F15 run keys work on a selected cell in command mode", async () => {
  const { host, calls, close } = await mount();
  try {
    const article = host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "Enter", ctrlKey: true });
    expect(calls.run).toHaveBeenCalledTimes(1);
    await press(article, { key: "Enter", shiftKey: true });
    expect(calls.runAndAdvance).toHaveBeenLastCalledWith(false);
    await press(article, { key: "Enter", altKey: true });
    expect(calls.runAndAdvance).toHaveBeenLastCalledWith(true);
  } finally {
    await close();
  }
});

it("report A2-FIND-20261116-F11 c copies and x cuts a selected cell in command mode", async () => {
  toastSuccess.mockClear();
  let clipboard = "";
  const writeText = vi.fn(async (value: string) => {
    clipboard = value;
  });
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText },
  });
  const { host, calls, close } = await mount();
  try {
    const article = host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "c", code: "KeyC" });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(clipboard).toContain("SELECT 1");
    expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard!");
    expect(calls.commandDelete).not.toHaveBeenCalled();

    await press(article, { key: "x", code: "KeyX" });
    await vi.waitFor(() =>
      expect(calls.commandDelete).toHaveBeenCalledTimes(1),
    );
    expect(toastSuccess).toHaveBeenCalledTimes(2);
  } finally {
    await close();
  }
});

it("report A2-FIND-20261116-F11 m converts a code cell to markdown and y converts markdown to code", async () => {
  const codeCell: Cell = {
    ...cell,
    contents: {
      id: "cell",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "code",
      language: "python",
      source: "x = 1",
      resultVariable: null,
      outputResult: true,
    },
  };
  const mountedCode = await mount({ cell: codeCell, draftText: "x = 1" });
  try {
    const article = mountedCode.host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "m", code: "KeyM" });
    expect(mountedCode.calls.saveContents).toHaveBeenCalledWith({
      id: "cell",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "markdown",
      markdown: "x = 1",
    });
  } finally {
    await mountedCode.close();
  }

  const markdownCell: Cell = {
    ...cell,
    contents: {
      id: "cell",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "markdown",
      markdown: "Notes",
    },
  };
  const mountedMd = await mount({ cell: markdownCell, draftText: "Notes" });
  try {
    const article = mountedMd.host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "y", code: "KeyY" });
    expect(mountedMd.calls.saveContents).toHaveBeenCalledWith({
      id: "cell",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "code",
      language: "python",
      source: "Notes",
      resultVariable: null,
      outputResult: true,
    });
  } finally {
    await mountedMd.close();
  }
});
