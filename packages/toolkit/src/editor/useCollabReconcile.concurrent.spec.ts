// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { useCollabReconcile, getEditorMarkdown } from "./useCollabReconcile.js";

/**
 * Concurrent-edit / lost-update coverage for the reconcile hook (non-collab
 * controlled-value path — the same guards run there, and it's deterministic
 * without a live Yjs peer). The idempotent spec covers the escalation loop;
 * these cover the OTHER lost-update hazards the hook guards against:
 *
 *  - A deliberate revert-to-a-previous-value AFTER a local edit must still land
 *    (it must not be swallowed as "our own echo").
 *  - registerEmitted must refuse to persist an empty doc in collab mode (so a
 *    pre-seed empty editor never writes "" over real stored content).
 *
 * NOTE: the "stale poll arrives WHILE the user is actively typing" guard is
 * gated on `editor.isFocused`, which is always false under happy-dom (no real
 * DOM focus). That path is verified in the browser E2E pass instead.
 */

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
  vi.useRealTimers();
  container.remove();
});

interface HarnessProps {
  value: string;
  contentUpdatedAt: string;
}

interface CollabSeedHarnessProps {
  collabSynced: boolean;
  fragmentLength: number;
}

interface Captured {
  editor: Editor | null;
  emitted: string[];
  setContentCalls: number;
  registerEmitted?: (markdown: string) => boolean;
}

function makeHarness() {
  const captured: Captured = { editor: null, emitted: [], setContentCalls: 0 };

  function Harness({ value, contentUpdatedAt }: HarnessProps) {
    const guardsRef = React.useRef<ReturnType<
      typeof useCollabReconcile
    > | null>(null);

    const editor = useEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
      content: value,
      onUpdate: ({ editor, transaction }) => {
        const guards = guardsRef.current;
        if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
        const markdown = getEditorMarkdown(editor);
        if (!guards.registerEmitted(markdown)) return;
        captured.emitted.push(markdown);
      },
    });
    captured.editor = editor;

    const guards = useCollabReconcile({
      editor,
      value,
      contentUpdatedAt,
      editable: true,
      getMarkdown: getEditorMarkdown,
      setContent: (ed, v, options) => {
        captured.setContentCalls += 1;
        if (options.addToHistory === false) {
          ed.chain()
            .command(({ tr }) => {
              tr.setMeta("addToHistory", false);
              return true;
            })
            .setContent(v, { emitUpdate: options.emitUpdate })
            .run();
          return;
        }
        ed.commands.setContent(v);
      },
    });
    guardsRef.current = guards;
    captured.registerEmitted = guards.registerEmitted;

    return React.createElement("div", null);
  }

  return { captured, Harness };
}

function makeCollabSeedHarness(initialContent = "") {
  const captured: Captured = { editor: null, emitted: [], setContentCalls: 0 };

  function Harness({ collabSynced, fragmentLength }: CollabSeedHarnessProps) {
    const guardsRef = React.useRef<ReturnType<
      typeof useCollabReconcile
    > | null>(null);
    const fragmentLengthRef = React.useRef(fragmentLength);
    fragmentLengthRef.current = fragmentLength;
    const fakeYdoc = React.useMemo(
      () => ({
        clientID: 1,
        getXmlFragment: () => ({ length: fragmentLengthRef.current }),
      }),
      [],
    );

    const editor = useEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
      content: initialContent,
      onUpdate: ({ editor, transaction }) => {
        const guards = guardsRef.current;
        if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
        const markdown = getEditorMarkdown(editor);
        if (!guards.registerEmitted(markdown)) return;
        captured.emitted.push(markdown);
      },
    });
    captured.editor = editor;

    const guards = useCollabReconcile({
      editor,
      ydoc: fakeYdoc as never,
      collabSynced,
      value: "seeded content",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      editable: true,
      getMarkdown: getEditorMarkdown,
      setContent: (ed, v) => {
        captured.setContentCalls += 1;
        ed.commands.setContent(v);
      },
    });
    guardsRef.current = guards;

    return React.createElement("div", null);
  }

  return { captured, Harness };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function render(
  root: Root,
  Harness: (p: HarnessProps) => React.ReactElement,
  props: HarnessProps,
) {
  act(() => {
    root.render(React.createElement(Harness, props));
  });
}

describe("useCollabReconcile — concurrent edit / lost-update guards", () => {
  it("does not seed until initial collab sync has completed", async () => {
    const { captured, Harness } = makeCollabSeedHarness();

    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: false,
          fragmentLength: 0,
        }),
      );
    });
    await flush();

    expect(captured.setContentCalls).toBe(0);

    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 0,
        }),
      );
    });
    await flush();

    expect(captured.setContentCalls).toBe(1);
    expect(getEditorMarkdown(captured.editor!)).toBe("seeded content");
  });

  it("does not seed after initial collab sync reveals existing canonical content", async () => {
    const { captured, Harness } = makeCollabSeedHarness("seeded content");

    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: false,
          fragmentLength: 0,
        }),
      );
    });
    await flush();

    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
        }),
      );
    });
    await flush();

    expect(captured.setContentCalls).toBe(0);
    expect(getEditorMarkdown(captured.editor!)).toBe("seeded content");
  });

  it("applies a deliberate REVERT to a previously-applied value after a local edit (not swallowed as echo)", async () => {
    // Regression for the revert-safety carve-out: the doc-equivalence echo
    // guards (value === lastAppliedValueRef) only fire when the editor is
    // UNCHANGED since the last apply. If the user has since edited, an external
    // snapshot equal to a previously-applied value is a REAL revert (e.g. the
    // agent restored an earlier version) and must land, not be skipped.
    const { captured, Harness } = makeHarness();

    // 1. Agent applies V1.
    render(root, Harness, {
      value: "# V1 content",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
    });
    await flush();
    expect(getEditorMarkdown(captured.editor!)).toBe("# V1 content");

    // 2. Agent applies V2 (newer). Now lastApplied tracks V2.
    render(root, Harness, {
      value: "# V2 content",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
    });
    await flush();
    expect(getEditorMarkdown(captured.editor!)).toBe("# V2 content");

    // 3. The agent REVERTS back to the V1 content with a NEWER timestamp (a
    // genuine "undo my last change" external edit). Even though "# V1 content"
    // was applied before, it must re-apply — the newer timestamp makes it a real
    // external change, and the editor currently shows V2 (not V1).
    render(root, Harness, {
      value: "# V1 content",
      contentUpdatedAt: "2024-01-01T00:00:03.000Z",
    });
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("# V1 content");
  });

  it("applies a newer authoritative revert that matches a prior mount-time emission", async () => {
    const { captured, Harness } = makeHarness();

    render(root, Harness, {
      value: "# V1 content",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
    });
    await flush();
    render(root, Harness, {
      value: "# V2 content",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
    });
    await flush();
    expect(getEditorMarkdown(captured.editor!)).toBe("# V2 content");

    // A collab mount/schema-normalization transaction can emit the old V1
    // bytes even though the authoritative apply has already moved the editor
    // to V2. Record that echo without focusing/typing in the editor.
    expect(captured.registerEmitted?.("# V1 content")).toBe(true);

    render(root, Harness, {
      value: "# V1 content",
      contentUpdatedAt: "2024-01-01T00:00:03.000Z",
    });
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("# V1 content");
  });

  it("ignores local-looking editor updates until collaborative seeding completes", async () => {
    const results: boolean[] = [];

    function Probe() {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
        content: "",
      });
      const fakeYdoc = { clientID: 1, getXmlFragment: () => ({ length: 0 }) };
      const guards = useCollabReconcile({
        editor,
        ydoc: fakeYdoc as never,
        collabSynced: false,
        value: "authoritative content",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
      });
      if (editor && results.length === 0) {
        results.push(guards.shouldIgnoreUpdate(editor.state.tr));
      }
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe)));
    await flush();

    expect(results).toEqual([true]);
  });

  it("allows the first user edit after an authoritative empty doc finishes loading", async () => {
    let shouldIgnoreUpdate:
      | ((transaction: Editor["state"]["tr"]) => boolean)
      | null = null;
    let editor: Editor | null = null;

    function Probe() {
      editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
        content: "",
      });
      const fakeYdoc = { clientID: 1, getXmlFragment: () => ({ length: 0 }) };
      const guards = useCollabReconcile({
        editor,
        ydoc: fakeYdoc as never,
        collabSynced: true,
        value: "",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
      });
      shouldIgnoreUpdate = guards.shouldIgnoreUpdate;
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe)));

    expect(editor).not.toBeNull();
    expect(shouldIgnoreUpdate).not.toBeNull();
    expect(shouldIgnoreUpdate!(editor!.state.tr)).toBe(false);
  });

  it("refuses to persist an empty doc in collab mode (registerEmitted guard)", async () => {
    // Directly exercise the guard contract: in collab mode an empty markdown
    // string must not be registered/persisted (would clobber stored content
    // before the shared Y.Doc seeds).
    const results: boolean[] = [];

    function Probe() {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
        content: "",
      });
      const fakeYdoc = { clientID: 1, getXmlFragment: () => ({ length: 0 }) };
      const guards = useCollabReconcile({
        editor,
        ydoc: fakeYdoc as never,
        value: "seeded content",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
      });
      if (editor && results.length === 0) {
        results.push(guards.registerEmitted("   ")); // whitespace-only → empty
        results.push(guards.registerEmitted("real text")); // non-empty
      }
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe)));
    await flush();

    expect(results[0]).toBe(false); // empty in collab mode → refused
    expect(results[1]).toBe(true); // real content → accepted
  });

  it("defers collab seed setContent to a cancellable timer task", async () => {
    const setContentValues: string[] = [];

    function Probe({ value }: { value: string }) {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
        content: "",
      });
      const fakeYdoc = { clientID: 1, getXmlFragment: () => ({ length: 0 }) };
      useCollabReconcile({
        editor,
        ydoc: fakeYdoc as never,
        value,
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        setContent: (ed, v) => {
          setContentValues.push(v);
          ed.commands.setContent(v);
        },
      });
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe, { value: "first seed" })));
    expect(setContentValues).toEqual([]);

    act(() =>
      root.render(React.createElement(Probe, { value: "second seed" })),
    );
    expect(setContentValues).toEqual([]);

    await flush();

    expect(setContentValues).toEqual(["second seed"]);
  });

  it("does not seed beside persisted Y.Doc content projected during initial sync", async () => {
    const persistedYdoc = new Y.Doc();
    const persistedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: persistedYdoc,
      }),
    });
    persistedEditor.commands.setContent("persisted collab body");
    const persistedUpdate = Y.encodeStateAsUpdate(persistedYdoc);
    persistedEditor.destroy();
    persistedYdoc.destroy();

    const liveYdoc = new Y.Doc();
    const setContentValues: string[] = [];
    let capturedEditor: Editor | null = null;

    function Probe({ collabSynced }: { collabSynced: boolean }) {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
      });
      capturedEditor = editor;
      useCollabReconcile({
        editor,
        ydoc: liveYdoc,
        collabSynced,
        value: "persisted collab body",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        setContent: (_editor, nextValue) => {
          setContentValues.push(nextValue);
        },
      });
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe, { collabSynced: false })));
    act(() => Y.applyUpdate(liveYdoc, persistedUpdate, "remote"));
    act(() => root.render(React.createElement(Probe, { collabSynced: true })));
    await flush();

    expect(getEditorMarkdown(capturedEditor!)).toBe("persisted collab body");
    expect(setContentValues).toEqual([]);
    expect(
      getEditorMarkdown(capturedEditor!).match(/persisted collab body/g),
    ).toHaveLength(1);
    liveYdoc.destroy();
  });

  it("adopts a nonempty synced Y.Doc instead of reconciling an empty SQL snapshot", async () => {
    vi.useFakeTimers();
    const persistedYdoc = new Y.Doc();
    const persistedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: persistedYdoc,
      }),
    });
    persistedEditor.commands.setContent("live collaborator body");
    const liveYdoc = new Y.Doc();
    Y.applyUpdate(liveYdoc, Y.encodeStateAsUpdate(persistedYdoc), "remote");
    persistedEditor.destroy();
    persistedYdoc.destroy();

    const awareness = new Awareness(liveYdoc);
    const setContentValues: string[] = [];
    let capturedEditor: Editor | null = null;

    function Probe() {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
      });
      capturedEditor = editor;
      useCollabReconcile({
        editor,
        ydoc: liveYdoc,
        awareness,
        collabSynced: true,
        value: "",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        setContent: (_editor, nextValue) => {
          setContentValues.push(nextValue);
        },
      });
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe)));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    // The document state can finish syncing before the first awareness poll.
    // Publish the active peer after mount to cover that real transport order.
    act(() => {
      awareness.getStates().set(4_294_967_295, {
        user: { name: "Active peer" },
        visible: true,
      });
      awareness.emit("change", [
        { added: [4_294_967_295], updated: [], removed: [] },
        "remote",
      ]);
    });
    await act(async () => vi.advanceTimersByTimeAsync(2500));

    expect(getEditorMarkdown(capturedEditor!)).toBe("live collaborator body");
    expect(setContentValues).toEqual([]);
    vi.useRealTimers();
    awareness.destroy();
    liveYdoc.destroy();
  });

  it("lets canonical empty SQL clear stale persisted Y.Doc content with no active peer", async () => {
    const persistedYdoc = new Y.Doc();
    const persistedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: persistedYdoc,
      }),
    });
    persistedEditor.commands.setContent("stale persisted body");
    const liveYdoc = new Y.Doc();
    Y.applyUpdate(liveYdoc, Y.encodeStateAsUpdate(persistedYdoc), "remote");
    persistedEditor.destroy();
    persistedYdoc.destroy();

    const setContentValues: string[] = [];
    let capturedEditor: Editor | null = null;
    const awareness = new Awareness(liveYdoc);

    function Probe() {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
      });
      capturedEditor = editor;
      useCollabReconcile({
        editor,
        ydoc: liveYdoc,
        awareness,
        collabSynced: true,
        value: "",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        setContent: (editorToClear, nextValue) => {
          setContentValues.push(nextValue);
          editorToClear.commands.setContent(nextValue);
        },
      });
      return React.createElement("div", null);
    }

    vi.useFakeTimers();
    act(() => root.render(React.createElement(Probe)));
    await act(async () => vi.advanceTimersByTimeAsync(2499));
    expect(setContentValues).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(51));

    expect(setContentValues).toContain("");
    expect(getEditorMarkdown(capturedEditor!)).toBe("");
    vi.useRealTimers();
    awareness.destroy();
    liveYdoc.destroy();
  });

  it("preserves and permits a first local edit during the awareness settle window", async () => {
    const persistedYdoc = new Y.Doc();
    const persistedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: persistedYdoc,
      }),
    });
    persistedEditor.commands.setContent("stale persisted body");
    const liveYdoc = new Y.Doc();
    Y.applyUpdate(liveYdoc, Y.encodeStateAsUpdate(persistedYdoc), "remote");
    persistedEditor.destroy();
    persistedYdoc.destroy();

    const awareness = new Awareness(liveYdoc);
    let capturedEditor: Editor | null = null;
    let guards: ReturnType<typeof useCollabReconcile> | null = null;
    const setContentValues: string[] = [];

    function Probe() {
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
      });
      capturedEditor = editor;
      guards = useCollabReconcile({
        editor,
        ydoc: liveYdoc,
        awareness,
        collabSynced: true,
        value: "",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        setContent: (editorToSet, nextValue) => {
          setContentValues.push(nextValue);
          editorToSet.commands.setContent(nextValue);
        },
      });
      return React.createElement("div", null);
    }

    vi.useFakeTimers();
    act(() => root.render(React.createElement(Probe)));
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(guards).not.toBeNull();
    expect(capturedEditor).not.toBeNull();
    expect(guards!.shouldIgnoreUpdate(capturedEditor!.state.tr)).toBe(false);
    expect(guards!.registerEmitted("first local edit")).toBe(true);
    act(() => capturedEditor!.commands.setContent("first local edit"));

    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(getEditorMarkdown(capturedEditor!)).toBe("first local edit");
    expect(setContentValues).toEqual([]);

    vi.useRealTimers();
    awareness.destroy();
    liveYdoc.destroy();
  });

  it("applies a genuinely newer external value once the user is no longer focused", async () => {
    const { captured, Harness } = makeHarness();

    render(root, Harness, {
      value: "# Doc",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
    });
    await flush();

    // Blur the editor so the typing/focus guard does not defer.
    act(() => captured.editor!.commands.blur());

    render(root, Harness, {
      value: "# Doc updated by agent",
      contentUpdatedAt: "2024-01-01T00:00:05.000Z",
    });
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("# Doc updated by agent");
  });
});
