import { EditorView } from "@uiw/react-codemirror";
// @vitest-environment jsdom
import { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import type { Cell } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

it("report A2-SQL-INITIAL-FILL-CONCAT preserves initial selection and replacement before Run", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const run = vi.fn();
  let initial: HTMLElement | null = null;
  const original = "SELECT * FROM orders LIMIT 100";
  const replacement = "SELECT * FROM orders LIMIT 3";
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
      source: original,
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  };
  function Harness() {
    const [text, setText] = useState(original);
    useLayoutEffect(() => {
      initial = host.querySelector("textarea, .cm-content");
      initial?.focus();
      if (initial instanceof HTMLTextAreaElement) initial.select();
    }, []);
    return (
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
        connectionId={null}
        draftText={text}
        dirty={text !== original}
        stale={false}
        outputState={undefined}
        error={null}
        onTextChange={setText}
        onSaveDraft={() => {}}
        onRun={() => run(text)}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    const editor = host.querySelector<HTMLElement>(".cm-content");
    assert(editor);
    if (initial) {
      expect(initial).toBe(editor);
      expect((initial as HTMLElement).isConnected).toBe(true);
      expect(document.activeElement).toBe(initial);
    }
    expect(host.querySelector("textarea")).toBeNull();
    const view = EditorView.findFromDOM(editor);
    assert(view);
    await act(async () => view.focus());
    await act(async () =>
      view.dispatch({ selection: { anchor: 0, head: original.length } }),
    );
    expect(document.activeElement).toBe(editor);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(original.length);
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: original.length, insert: replacement },
      });
    });
    expect(view.state.doc.toString()).toBe(replacement);
    expect(host.querySelector(".cm-line")?.textContent).toBe(replacement);
    expect(host.querySelector(".cm-line span")).not.toBeNull();
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(run).toHaveBeenCalledWith(replacement);
    const outside = document.createElement("button");
    host.append(outside);
    await act(async () => outside.focus());
    expect(document.activeElement).toBe(outside);
    expect(view.state.doc.toString()).toBe(replacement);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
