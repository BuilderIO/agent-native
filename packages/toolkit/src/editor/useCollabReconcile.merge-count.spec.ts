// @vitest-environment happy-dom

import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { getEditorMarkdown, useCollabReconcile } from "./useCollabReconcile.js";

// A tab counts each newer saved body it merges, and how many of that body's
// changes it set aside for overlapping its own edits.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface Snapshot {
  value: string;
  contentUpdatedAt: string;
  contentRevision: string;
}

function makeHarness({
  overlapPolicy,
  onBaseAwareMerge,
}: {
  overlapPolicy?: "conflict" | "prefer-live";
  onBaseAwareMerge?: (outcome: { setAside: number }) => void;
}) {
  const captured = {
    editor: null as Editor | null,
    merges: [] as Array<{ setAside: number }>,
    reconciled: [] as string[],
  };

  function Harness(snapshot: Snapshot) {
    const editor = useEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
      content: snapshot.value,
    });
    captured.editor = editor;
    useCollabReconcile({
      editor,
      ...snapshot,
      overlapPolicy,
      onBaseAwareReconcile: (result) => captured.reconciled.push(result.status),
      onBaseAwareMerge: (outcome) => {
        captured.merges.push(outcome);
        onBaseAwareMerge?.(outcome);
      },
      editable: true,
      isEditorFocused: () => false,
      getMarkdown: getEditorMarkdown,
    });
    return React.createElement("div", null);
  }

  const render = async (snapshot: Snapshot) => {
    act(() => root.render(React.createElement(Harness, snapshot)));
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  return { captured, render };
}

const opened: Snapshot = {
  value: "Intro.\n\n1. One\n2. Two",
  contentUpdatedAt: "2024-01-01T00:00:01.000Z",
  contentRevision: "revision-1",
};

const agentAppended: Snapshot = {
  value: "Intro.\n\n1. One\n2. Two\n3. Three",
  contentUpdatedAt: "2024-01-01T00:00:02.000Z",
  contentRevision: "revision-2",
};

function typeAtEndOfList(editor: Editor, text: string) {
  const { doc } = editor.state;
  act(() => {
    editor.commands.insertContentAt(
      doc.child(0).nodeSize + doc.child(1).nodeSize - 3,
      text,
    );
  });
}

describe("useCollabReconcile merge counts", () => {
  it("counts an agent's item added to a closing list as kept, once", async () => {
    const { captured, render } = makeHarness({ overlapPolicy: "prefer-live" });
    await render(opened);
    // Any transaction, like a click into the page, lets TrailingNode add it.
    act(() => {
      captured.editor!.commands.setTextSelection(1);
    });
    expect(captured.editor!.state.doc.lastChild!.content.size).toBe(0);

    await render(agentAppended);
    await render(agentAppended);

    expect(getEditorMarkdown(captured.editor!)).toContain("3. Three");
    expect(captured.merges).toEqual([{ setAside: 0 }]);
  });

  it("counts a change set aside for overlapping the tab's edit", async () => {
    const { captured, render } = makeHarness({ overlapPolicy: "prefer-live" });
    await render(opened);
    typeAtEndOfList(captured.editor!, " local");
    const live = getEditorMarkdown(captured.editor!);

    await render(agentAppended);

    expect(getEditorMarkdown(captured.editor!)).toBe(live);
    expect(captured.merges).toEqual([{ setAside: 1 }]);
  });

  it("counts nothing for a conflict the host resolves", async () => {
    const { captured, render } = makeHarness({});
    await render(opened);
    typeAtEndOfList(captured.editor!, " local");

    await render(agentAppended);

    expect(captured.reconciled).toEqual(["conflict"]);
    expect(captured.merges).toEqual([]);
  });

  it("counts nothing when the saved body already matches the tab", async () => {
    const { captured, render } = makeHarness({ overlapPolicy: "prefer-live" });
    await render(opened);
    await render({ ...opened, contentRevision: "revision-2" });

    expect(captured.merges).toEqual([]);
  });

  it("counts nothing for a newer revision that left the body as it was", async () => {
    const { captured, render } = makeHarness({ overlapPolicy: "prefer-live" });
    await render(opened);
    typeAtEndOfList(captured.editor!, " local");
    const live = getEditorMarkdown(captured.editor!);

    await render({
      ...opened,
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      contentRevision: "revision-2",
    });

    expect(getEditorMarkdown(captured.editor!)).toBe(live);
    expect(captured.merges).toEqual([]);
  });

  it("merges and saves the same when counting throws", async () => {
    const { captured, render } = makeHarness({
      overlapPolicy: "prefer-live",
      onBaseAwareMerge: () => {
        throw new Error("counting failed");
      },
    });
    await render(opened);
    typeAtEndOfList(captured.editor!, " local");
    await render({
      value: "Intro, revised.\n\n1. One\n2. Two",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      contentRevision: "revision-2",
    });
    await render({
      value: "Intro, revised twice.\n\n1. One\n2. Two",
      contentUpdatedAt: "2024-01-01T00:00:03.000Z",
      contentRevision: "revision-3",
    });

    expect(getEditorMarkdown(captured.editor!)).toBe(
      "Intro, revised twice.\n\n1. One\n2. Two local",
    );
    expect(captured.reconciled).toEqual(["merged", "merged"]);
    expect(captured.merges).toEqual([{ setAside: 0 }, { setAside: 0 }]);
  });
});
