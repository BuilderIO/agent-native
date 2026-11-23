// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import type { Cell } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

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

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls = {
    addAbove: vi.fn(),
    addBelow: vi.fn(),
    commandAdd: vi.fn(),
  };
  await act(async () =>
    root.render(
      <NotebookCell
        cell={cell}
        title="SQL 1"
        connections={[]}
        canEdit
        busy={false}
        running={false}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId="connection"
        draftText="SELECT 1"
        dirty={false}
        stale={false}
        outputState={undefined}
        error={null}
        onTextChange={() => {}}
        onSaveDraft={() => {}}
        onRun={() => {}}
        onAddAbove={calls.addAbove}
        onAddBelow={calls.addBelow}
        onCommandAdd={calls.commandAdd}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />,
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

it("expected behavior: in command mode a kind letter adds that kind below the selected cell without opening the add bar", async () => {
  const { host, calls, close } = await mount();
  try {
    const article = host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "e", code: "KeyE" });
    await press(article, { key: "w", code: "KeyW" });
    await press(article, { key: "t", code: "KeyT" });
    expect(calls.commandAdd.mock.calls).toEqual([
      ["text", false],
      ["code", false],
      ["display-table", false],
    ]);
    expect(calls.addBelow).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

it("expected behavior: in command mode A and B add a cell of the selected cell's own kind above and below", async () => {
  const { host, calls, close } = await mount();
  try {
    const article = host.querySelector<HTMLElement>("article");
    assert(article);
    await act(async () => article.focus());
    await press(article, { key: "a", code: "KeyA" });
    await press(article, { key: "b", code: "KeyB" });
    expect(calls.commandAdd.mock.calls).toEqual([
      [undefined, true],
      [undefined, false],
    ]);
    expect(calls.addAbove).not.toHaveBeenCalled();
    expect(calls.addBelow).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

it("expected behavior: kind letters typed while editing the source do not add cells", async () => {
  const { host, calls, close } = await mount();
  try {
    const editor = host.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    await act(async () => editor.focus());
    await press(editor, { key: "q", code: "KeyQ" });
    expect(calls.commandAdd).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});
