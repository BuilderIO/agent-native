// @vitest-environment happy-dom

import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
