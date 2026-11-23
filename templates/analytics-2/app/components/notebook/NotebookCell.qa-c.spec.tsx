// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import type { Cell } from "@/lib/model/contracts";

import { decodeCellFromClipboard } from "./cell-clipboard";
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
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onDelete = vi.fn();
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
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={onDelete}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />,
    ),
  );
  const article = host.querySelector<HTMLElement>("article");
  assert(article);
  await act(async () => article.focus());
  const close = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { article, writeText, onDelete, close };
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

it("copies the selected cell with Ctrl+C in command mode and keeps it", async () => {
  const { article, writeText, onDelete, close } = await mount();
  try {
    await press(article, { key: "c", code: "KeyC", ctrlKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(decodeCellFromClipboard(writeText.mock.calls[0]![0])).toMatchObject({
      kind: "sql",
      source: "SELECT 1",
    });
    expect(onDelete).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

it("cuts the selected cell with Ctrl+X: copies it, then deletes it", async () => {
  const { article, writeText, onDelete, close } = await mount();
  try {
    await press(article, { key: "x", code: "KeyX", metaKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  } finally {
    await close();
  }
});

it("does not delete the cell when the clipboard write fails during a cut", async () => {
  const { article, writeText, onDelete, close } = await mount();
  try {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await press(article, { key: "x", code: "KeyX", ctrlKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

const textCell: Cell = {
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
    kind: "text",
    text: "hello",
  },
};

async function mountText(justAdded: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <NotebookCell
        cell={textCell}
        title="Text 1"
        connections={[]}
        canEdit
        busy={false}
        running={false}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId={null}
        draftText="hello"
        dirty={false}
        stale={false}
        outputState={undefined}
        error={null}
        justAdded={justAdded}
        onTextChange={() => {}}
        onSaveDraft={() => {}}
        onRun={() => {}}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />,
    ),
  );
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("does not move focus into a text cell that merely mounts (load, undo restore)", async () => {
  const { host, close } = await mountText(false);
  try {
    const editor = host.querySelector("textarea");
    expect(editor).not.toBeNull();
    expect(document.activeElement).not.toBe(editor);
  } finally {
    await close();
  }
});

it("still focuses the editor of a text cell that was just added", async () => {
  const { host, close } = await mountText(true);
  try {
    expect(document.activeElement).toBe(host.querySelector("textarea"));
  } finally {
    await close();
  }
});
