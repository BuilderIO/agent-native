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
  contentRevision?: string;
  editorOwnedFocus?: boolean;
  isEditorFocused?: () => boolean;
}

interface CollabSeedHarnessProps {
  collabSynced: boolean;
  fragmentLength: number;
  value?: string;
  contentRevision?: string;
  contentUpdatedAt?: string;
  initialAppliedUpdatedAt?: string | null;
}

interface Captured {
  editor: Editor | null;
  emitted: string[];
  setContentCalls: number;
  registerEmitted?: (markdown: string) => boolean;
  reconciled?: Array<{
    status: "merged" | "conflict" | "failed";
    content: string;
  }>;
}

function makeHarness() {
  const captured: Captured = { editor: null, emitted: [], setContentCalls: 0 };

  function Harness({
    value,
    contentUpdatedAt,
    contentRevision,
    editorOwnedFocus = false,
    isEditorFocused,
  }: HarnessProps) {
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
      contentRevision,
      onBaseAwareReconcile: (result) => {
        (captured.reconciled ??= []).push({
          status: result.status,
          content: result.content,
        });
      },
      editable: true,
      isEditorFocused: isEditorFocused ?? (() => editorOwnedFocus),
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

  function Harness({
    collabSynced,
    fragmentLength,
    value = "seeded content",
    contentRevision,
    contentUpdatedAt = "2024-01-01T00:00:01.000Z",
    initialAppliedUpdatedAt,
  }: CollabSeedHarnessProps) {
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
      value,
      contentUpdatedAt,
      contentRevision,
      initialAppliedUpdatedAt,
      onBaseAwareReconcile: (result) => {
        (captured.reconciled ??= []).push({
          status: result.status,
          content: result.content,
        });
      },
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

function makePeerReconcileHarness(initialContent = "original body") {
  const ydoc = new Y.Doc();
  ydoc.clientID = 2;
  const seedEditor = new CoreEditor({
    extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc }),
  });
  seedEditor.commands.setContent(initialContent);
  seedEditor.destroy();
  const awareness = new Awareness(ydoc);
  awareness.getStates().set(3, {
    user: { name: "Peer" },
    visible: true,
    canFlushDocument: true,
  });
  const writes: Array<{ value: string; callbackVersion: number }> = [];
  const reconciled: Array<{ status: string; baseRevision: string }> = [];
  let editor: Editor | null = null;
  function Harness({
    value = initialContent,
    revision = "revision-1",
    callbackVersion = 0,
    available = true,
    collabContentRevision,
    requestCollabSync,
    baseAware = false,
  }: {
    value?: string;
    revision?: string;
    callbackVersion?: number;
    available?: boolean;
    collabContentRevision?: string;
    requestCollabSync?: () => Promise<{
      status: "synced" | "failed" | "unavailable";
    }>;
    baseAware?: boolean;
  }) {
    editor = useEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc }),
    });
    useCollabReconcile({
      editor: available ? editor : null,
      ydoc,
      awareness,
      collabSynced: true,
      value,
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      contentRevision: revision,
      collabContentRevision,
      requestCollabSync,
      initialAppliedUpdatedAt: null,
      editable: true,
      parseValue: baseAware ? undefined : false,
      onBaseAwareReconcile: baseAware
        ? (result) => {
            reconciled.push(result);
          }
        : undefined,
      getMarkdown: (editorToRead) => getEditorMarkdown(editorToRead),
      setContent: (editorToWrite, nextValue, options) => {
        writes.push({ value: nextValue, callbackVersion });
        editorToWrite.commands.setContent(nextValue, {
          emitUpdate: options.emitUpdate,
        });
      },
    });
    return React.createElement("div", null);
  }
  return {
    Harness,
    writes,
    reconciled,
    awareness,
    ydoc,
    editor: () => editor!,
    markdown: () => getEditorMarkdown(editor!),
    dispose: () => {
      act(() => root.unmount());
      root = createRoot(container);
      awareness.destroy();
      ydoc.destroy();
    },
  };
}

function makeConnectedEditorHarness(authorLeads: boolean) {
  const docs = [new Y.Doc(), new Y.Doc()];
  docs[0]!.clientID = authorLeads ? 1 : 2;
  docs[1]!.clientID = authorLeads ? 2 : 1;
  const awareness = docs.map((doc) => new Awareness(doc));
  docs.forEach((doc, index) => {
    doc.on("update", (update, origin) => {
      if (origin !== "peer") Y.applyUpdate(docs[1 - index]!, update, "peer");
    });
    awareness[index]!.getStates().set(1, {
      user: { name: "First editor" },
      visible: true,
      canFlushDocument: true,
    });
    awareness[index]!.getStates().set(2, {
      user: { name: "Second editor" },
      visible: true,
      canFlushDocument: true,
    });
  });
  const editors: Array<Editor | null> = [null, null];
  const emitted: string[][] = [[], []];
  const reconciled: Array<{ status: string; content: string }> = [];
  function Probe({ index, ...props }: HarnessProps & { index: number }) {
    const guardsRef = React.useRef<ReturnType<
      typeof useCollabReconcile
    > | null>(null);
    const editor = useEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: docs[index],
      }),
      onUpdate: ({ editor, transaction }) => {
        const guards = guardsRef.current;
        if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
        const markdown = getEditorMarkdown(editor);
        if (guards.registerEmitted(markdown)) emitted[index]!.push(markdown);
      },
    });
    editors[index] = editor;
    guardsRef.current = useCollabReconcile({
      editor,
      ydoc: docs[index],
      awareness: awareness[index],
      collabSynced: true,
      value: props.value,
      contentUpdatedAt: props.contentUpdatedAt,
      contentRevision: props.contentRevision,
      onBaseAwareReconcile: (result) =>
        reconciled.push({ status: result.status, content: result.content }),
      getMarkdown: (editorToRead) => getEditorMarkdown(editorToRead),
      initialAppliedUpdatedAt: null,
      editable: true,
    });
    return React.createElement("div");
  }
  function Harness(props: HarnessProps) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Probe, { ...props, index: 0 }),
      React.createElement(Probe, { ...props, index: 1 }),
    );
  }
  return {
    Harness,
    editors,
    emitted,
    reconciled,
    markdown: () => editors.map((editor) => getEditorMarkdown(editor!)),
    dispose: () => {
      act(() => root.unmount());
      root = createRoot(container);
      awareness.forEach((state) => state.destroy());
      docs.forEach((doc) => doc.destroy());
    },
  };
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
  it("does not seed an empty editor from a collab-backed SQL snapshot", async () => {
    vi.useFakeTimers();
    const harness = makePeerReconcileHarness("");
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(harness.ydoc));
    const serverEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: serverDoc,
      }),
    });
    serverEditor.commands.insertContentAt(1, "Accepted body");
    let finishSync!: (result: { status: "synced" }) => void;
    const requestCollabSync = () =>
      new Promise<{ status: "synced" }>((resolve) => {
        finishSync = resolve;
      });
    try {
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            value: "Accepted body",
            revision: "revision-2",
            collabContentRevision: "revision-2",
            requestCollabSync,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(30000));
      expect(harness.markdown()).toBe("");
      expect(harness.writes).toEqual([]);
      act(() =>
        Y.applyUpdate(harness.ydoc, Y.encodeStateAsUpdate(serverDoc), "remote"),
      );
      await act(async () => finishSync({ status: "synced" }));
      expect(harness.markdown()).toBe("Accepted body");
      expect(harness.writes).toEqual([]);
    } finally {
      serverEditor.destroy();
      serverDoc.destroy();
      harness.dispose();
    }
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    "receives a collab-backed revision exactly once without SQL fallback (local tail: %s, sync failure: %s)",
    async (localTail, syncFailure) => {
      vi.useFakeTimers();
      const baseline = "original body\n\nSecond paragraph.";
      const harness = makePeerReconcileHarness(baseline);
      const serverDoc = new Y.Doc();
      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(harness.ydoc));
      const serverEditor = new CoreEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: serverDoc,
        }),
      });
      let finishSync!: (result: { status: "synced" }) => void;
      const requestSync = vi.fn<() => Promise<{ status: "synced" | "failed" }>>(
        () =>
          new Promise((resolve) => {
            finishSync = resolve;
          }),
      );
      if (syncFailure) requestSync.mockResolvedValueOnce({ status: "failed" });
      try {
        act(() => root.render(React.createElement(harness.Harness)));
        await act(async () => vi.advanceTimersByTimeAsync(30));
        const stateVector = Y.encodeStateVector(harness.ydoc);
        serverEditor.commands.insertContentAt(1, "Accepted ");
        if (localTail) {
          act(() =>
            harness
              .editor()
              .commands.insertContentAt(
                harness.editor().state.doc.content.size - 1,
                " local tail",
              ),
          );
        }
        const props = {
          value: `Accepted ${baseline}`,
          revision: "revision-2",
          collabContentRevision: "revision-2",
          requestCollabSync: requestSync,
          baseAware: true,
        };
        act(() => root.render(React.createElement(harness.Harness, props)));
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        act(() =>
          root.render(
            React.createElement(harness.Harness, {
              ...props,
              callbackVersion: 1,
            }),
          ),
        );
        expect(requestSync).toHaveBeenCalledTimes(syncFailure ? 2 : 1);
        expect(harness.writes).toEqual([]);
        expect(harness.markdown()).toBe(
          localTail ? `${baseline} local tail` : baseline,
        );
        act(() =>
          Y.applyUpdate(
            harness.ydoc,
            Y.encodeStateAsUpdate(serverDoc, stateVector),
            "remote",
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        expect(harness.markdown()).toBe(
          `Accepted ${baseline}${localTail ? " local tail" : ""}`,
        );
        expect(harness.writes).toEqual([]);
        // A partial cache update can retain the old marker; a different body
        // token must still take the ordinary SQL reconciliation path.
        act(() =>
          root.render(
            React.createElement(harness.Harness, {
              ...props,
              value: `Revised ${baseline}`,
              revision: "revision-3",
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(harness.writes).toEqual([]);
        expect(harness.reconciled).toEqual([]);
        expect(harness.markdown()).toBe(
          `Accepted ${baseline}${localTail ? " local tail" : ""}`,
        );
        await act(async () => finishSync({ status: "synced" }));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(harness.markdown()).toBe(
          `Revised ${baseline}${localTail ? " local tail" : ""}`,
        );
        if (localTail)
          expect(harness.reconciled).toEqual([
            expect.objectContaining({
              status: "merged",
              baseRevision: "revision-2",
            }),
          ]);
      } finally {
        serverEditor.destroy();
        serverDoc.destroy();
        harness.dispose();
      }
    },
  );
  it.each([true, false])(
    "preserves ordinary mark removal before SQL catches up (author leads: %s)",
    async (authorLeads) => {
      const harness = makeConnectedEditorHarness(authorLeads);
      const baseline = "***Bold*** sample.";
      const props = {
        value: baseline,
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        contentRevision: "revision-1",
      };
      vi.useFakeTimers();
      try {
        render(root, harness.Harness, props);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        expect(harness.markdown()).toEqual([baseline, baseline]);
        act(() => {
          harness.editors[0]!.chain()
            .setTextSelection({ from: 1, to: 5 })
            .toggleItalic()
            .run();
        });
        expect(harness.markdown()).toEqual([
          "**Bold** sample.",
          "**Bold** sample.",
        ]);
        expect(harness.emitted).toEqual([["**Bold** sample."], []]);
        render(root, harness.Harness, props);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        expect(harness.markdown()).toEqual([
          "**Bold** sample.",
          "**Bold** sample.",
        ]);
        expect(harness.emitted).toEqual([["**Bold** sample."], []]);
      } finally {
        harness.dispose();
      }
    },
  );

  it.each([false, true])(
    "merges newer authority after a remote mark change (timestamp ties: %s)",
    async (timestampTies) => {
      const harness = makeConnectedEditorHarness(false);
      const baseline = "***Bold*** sample.\n\nSecond line.";
      const props = {
        value: baseline,
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        contentRevision: "revision-1",
      };
      vi.useFakeTimers();
      try {
        render(root, harness.Harness, props);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        act(() => {
          harness.editors[0]!.chain()
            .setTextSelection({ from: 1, to: 5 })
            .toggleItalic()
            .run();
        });
        render(root, harness.Harness, {
          value: "***Bold*** sample.\n\nServer line.",
          contentUpdatedAt: timestampTies
            ? props.contentUpdatedAt
            : "2024-01-01T00:00:02.000Z",
          contentRevision: "revision-2",
        });
        await act(async () => vi.advanceTimersByTimeAsync(2501));
        expect(harness.markdown()).toEqual([
          "**Bold** sample.\n\nServer line.",
          "**Bold** sample.\n\nServer line.",
        ]);
        expect(harness.reconciled).toEqual([
          { status: "merged", content: "**Bold** sample.\n\nServer line." },
        ]);
      } finally {
        harness.dispose();
      }
    },
  );

  it("uses the latest callback at the original peer deadline, including the default normalizer", async () => {
    const harness = makePeerReconcileHarness();
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(harness.Harness)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      for (
        let callbackVersion = 1;
        callbackVersion <= 5;
        callbackVersion += 1
      ) {
        act(() =>
          root.render(
            React.createElement(harness.Harness, {
              value: "accepted body",
              revision: "revision-2",
              callbackVersion,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(500));
      }
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(harness.writes).toEqual([
        { value: "accepted body", callbackVersion: 5 },
      ]);
      expect(harness.markdown()).toBe("accepted body");
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(harness.writes).toHaveLength(1);
    } finally {
      harness.dispose();
    }
  });

  it("cancels an obsolete snapshot and starts the peer window for a newer revision", async () => {
    const harness = makePeerReconcileHarness();
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(harness.Harness)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            value: "accepted body",
            revision: "revision-2",
            callbackVersion: 1,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            value: "newer body",
            revision: "revision-3",
            callbackVersion: 2,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(501));
      expect(harness.writes).toEqual([]);
      expect(harness.markdown()).toBe("original body");
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(harness.writes).toEqual([
        { value: "newer body", callbackVersion: 2 },
      ]);
      expect(harness.markdown()).toBe("newer body");
    } finally {
      harness.dispose();
    }
  });

  it("cancels a peer reconciliation on unmount", async () => {
    const harness = makePeerReconcileHarness();
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(harness.Harness)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            value: "accepted body",
            revision: "revision-2",
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      act(() => root.render(null));
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(harness.writes).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("starts a fresh peer window when the same editor returns after being unavailable", async () => {
    const harness = makePeerReconcileHarness();
    vi.useFakeTimers();
    const snapshot = { value: "accepted body", revision: "revision-2" };
    try {
      act(() => root.render(React.createElement(harness.Harness)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      act(() => root.render(React.createElement(harness.Harness, snapshot)));
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            ...snapshot,
            available: false,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(harness.writes).toEqual([]);
      act(() => root.render(React.createElement(harness.Harness, snapshot)));
      await act(async () => vi.advanceTimersByTimeAsync(2499));
      expect(harness.writes).toEqual([]);
      await act(async () => vi.advanceTimersByTimeAsync(2));
      expect(harness.markdown()).toBe("accepted body");
    } finally {
      harness.dispose();
    }
  });

  it("cancels the peer deadline when leadership is lost and waits again after regaining it", async () => {
    const harness = makePeerReconcileHarness();
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(harness.Harness)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      act(() =>
        root.render(
          React.createElement(harness.Harness, {
            value: "accepted body",
            revision: "revision-2",
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      act(() => {
        harness.awareness
          .getStates()
          .set(1, { user: { name: "Lead peer" }, visible: true });
        harness.awareness.emit("change", [
          { added: [1], updated: [], removed: [] },
          "remote",
        ]);
      });
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(harness.writes).toEqual([]);
      act(() => {
        harness.awareness.getStates().delete(1);
        harness.awareness.emit("change", [
          { added: [], updated: [], removed: [1] },
          "remote",
        ]);
      });
      await act(async () => vi.advanceTimersByTimeAsync(2499));
      expect(harness.writes).toEqual([]);
      await act(async () => vi.advanceTimersByTimeAsync(2));
      expect(harness.markdown()).toBe("accepted body");
    } finally {
      harness.dispose();
    }
  });

  it.each([false, true])(
    "adopts an accepted canonical revision during repeated renders (fresh callbacks: %s)",
    async (freshCallbacks) => {
      const liveYdoc = new Y.Doc();
      liveYdoc.clientID = 1;
      const persistedEditor = new CoreEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
      });
      persistedEditor.commands.setContent("**Bold** sample");
      persistedEditor.destroy();
      const awareness = new Awareness(liveYdoc);
      awareness.getStates().set(2, {
        user: { name: "Peer" },
        visible: true,
        canFlushDocument: true,
      });
      let capturedEditor: Editor | null = null;
      const stableRead = (editor: Editor) => getEditorMarkdown(editor);
      const normalizeValue = (value: string) => value;
      const stableWrite = (editor: Editor, value: string) => {
        editor.commands.setContent(value);
      };
      function Probe({ accepted }: { accepted: boolean }) {
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
          value: accepted ? "**Changed** sample" : "**Bold** sample",
          contentUpdatedAt: accepted
            ? "2024-01-01T00:00:02.000Z"
            : "2024-01-01T00:00:01.000Z",
          editable: true,
          initialAppliedUpdatedAt: null,
          normalizeValue,
          getMarkdown: freshCallbacks
            ? (editor) => stableRead(editor)
            : stableRead,
          setContent: freshCallbacks
            ? (editor, value) => stableWrite(editor, value)
            : stableWrite,
        });
        return React.createElement("div", null);
      }
      vi.useFakeTimers();
      try {
        act(() => root.render(React.createElement(Probe, { accepted: false })));
        await act(async () => vi.advanceTimersByTimeAsync(30));
        expect(getEditorMarkdown(capturedEditor!)).toBe("**Bold** sample");
        const originalEditor = capturedEditor;
        act(() => root.render(React.createElement(Probe, { accepted: true })));
        for (let renderIndex = 0; renderIndex < 6; renderIndex += 1) {
          await act(async () => vi.advanceTimersByTimeAsync(500));
          act(() =>
            root.render(React.createElement(Probe, { accepted: true })),
          );
        }
        expect(capturedEditor).toBe(originalEditor);
        expect(getEditorMarkdown(capturedEditor!)).toBe("**Changed** sample");
      } finally {
        act(() => root.unmount());
        root = createRoot(container);
        awareness.destroy();
        liveYdoc.destroy();
      }
    },
  );

  it.each([false, true])(
    "acknowledges peer acceptance before a later local edit (arrival during apply: %s)",
    async (duringApply) => {
      const { captured, Harness } = makeHarness();
      const baseline =
        "Writers review exact changes.\n\nReaders retain context.";
      const accepted = baseline.replace("exact", "careful");
      const props = {
        value: accepted,
        contentUpdatedAt: "2024-01-01T00:00:02.000Z",
        contentRevision: "revision-2",
      };
      render(root, Harness, {
        value: baseline,
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        contentRevision: "revision-1",
      });
      await flush();
      const deliverPeer = () => {
        act(() =>
          captured.editor!.commands.setContent(accepted, { emitUpdate: false }),
        );
      };
      if (!duringApply) deliverPeer();
      render(root, Harness, props);
      if (duringApply) deliverPeer();
      await flush();
      expect(getEditorMarkdown(captured.editor!)).toBe(accepted);
      expect(captured.reconciled ?? []).toEqual([]);

      const draft = `${accepted} Peer suffix.`;
      act(() => captured.editor!.commands.setContent(draft));
      render(root, Harness, props);
      await flush();
      expect(getEditorMarkdown(captured.editor!)).toBe(draft);
      expect(captured.reconciled ?? []).toEqual([]);
    },
  );

  it("persists a local suffix when SQL acceptance arrives after peer text", async () => {
    const { captured, Harness } = makeHarness();
    const baseline =
      "Writers review precise changes.\n\nReaders retain context. Peer suffix.";
    const accepted = baseline.replace("precise", "clearse");
    render(root, Harness, {
      value: baseline,
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      contentRevision: "revision-1",
    });
    await flush();
    act(() =>
      captured.editor!.commands.setContent(accepted, { emitUpdate: false }),
    );
    const draft = `${accepted} Trace suffix.`;
    act(() =>
      captured.editor!.commands.insertContentAt(
        captured.editor!.state.doc.content.size - 1,
        " Trace suffix.",
      ),
    );
    const before = captured.editor!.state.doc;
    const props = {
      value: accepted,
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      contentRevision: "revision-2",
    };
    render(root, Harness, props);
    await flush();
    expect(captured.editor!.state.doc).toBe(before);
    expect(getEditorMarkdown(captured.editor!)).toBe(draft);
    expect(captured.reconciled).toEqual([{ status: "merged", content: draft }]);
    render(root, Harness, props);
    await flush();
    expect(captured.reconciled).toHaveLength(1);
  });

  it("merges a newer non-overlapping revision and reports the combined draft", async () => {
    const { captured, Harness } = makeHarness();
    render(root, Harness, {
      value: "Alpha\n\nBravo\n\nCharlie",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      contentRevision: "revision-1",
    });
    await flush();

    act(() =>
      captured.editor!.commands.setContent("Alpha local\n\nBravo\n\nCharlie"),
    );
    render(root, Harness, {
      value: "Alpha\n\nBravo\n\nCharlie server",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      contentRevision: "revision-2",
    });
    await flush();

    expect(captured.reconciled).toEqual([
      {
        status: "merged",
        content: "Alpha local\n\nBravo\n\nCharlie server",
      },
    ]);
    expect(getEditorMarkdown(captured.editor!)).toBe(
      "Alpha local\n\nBravo\n\nCharlie server",
    );
  });

  it("reports an overlap once and preserves the local draft", async () => {
    const { captured, Harness } = makeHarness();
    render(root, Harness, {
      value: "Alpha\n\nBravo",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      contentRevision: "revision-1",
    });
    await flush();
    act(() => captured.editor!.commands.setContent("Alpha local\n\nBravo"));

    const newer = {
      value: "Alpha server\n\nBravo",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      contentRevision: "revision-2",
    };
    render(root, Harness, newer);
    await flush();
    render(root, Harness, newer);
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("Alpha local\n\nBravo");
    expect(captured.reconciled).toEqual([
      { status: "conflict", content: "Alpha local\n\nBravo" },
    ]);
  });

  it("persists the first local edit after a synced empty collaborative document", async () => {
    const captured: Captured = {
      editor: null,
      emitted: [],
      setContentCalls: 0,
    };

    function EmptyDocumentHarness() {
      const guardsRef = React.useRef<ReturnType<
        typeof useCollabReconcile
      > | null>(null);
      const insertedRef = React.useRef(false);
      const ydoc = React.useMemo(() => new Y.Doc(), []);
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc }),
        onUpdate: ({ editor, transaction }) => {
          const guards = guardsRef.current;
          if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
          const markdown = getEditorMarkdown(editor);
          if (!guards.registerEmitted(markdown)) return;
          captured.emitted.push(markdown);
        },
      });
      captured.editor = editor;
      guardsRef.current = useCollabReconcile({
        editor,
        ydoc,
        collabSynced: true,
        value: "",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
        getMarkdown: getEditorMarkdown,
      });
      React.useLayoutEffect(() => {
        if (!editor || insertedRef.current) return;
        insertedRef.current = true;
        editor.view.dispatch(
          editor.state.tr
            .insertText("First persisted edit")
            .setMeta("uiEvent", "input"),
        );
      }, [editor]);
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(EmptyDocumentHarness)));
    await flush();

    expect(captured.emitted).toContain("First persisted edit");
  });

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

  it("preserves a registered local collab mark over an older-or-equal controlled snapshot", async () => {
    const canonical = "[Link](https://example.com/second) sample.";
    const { captured, Harness } = makeCollabSeedHarness(canonical);
    const props = {
      collabSynced: true,
      fragmentLength: 1,
      value: canonical,
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      initialAppliedUpdatedAt: null,
    };
    act(() => root.render(React.createElement(Harness, props)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    act(() => {
      captured
        .editor!.chain()
        .setTextSelection({ from: 1, to: 5 })
        .unsetLink()
        .run();
    });
    expect(captured.emitted.at(-1)).toBe("Link sample.");

    act(() => root.render(React.createElement(Harness, props)));
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("Link sample.");
    expect(captured.setContentCalls).toBe(0);
  });

  it("still applies newer authority after a registered local collab mark", async () => {
    const canonical = "[Link](https://example.com/second) sample.";
    const { captured, Harness } = makeCollabSeedHarness(canonical);
    act(() =>
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: canonical,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          initialAppliedUpdatedAt: null,
        }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    act(() => {
      captured.editor!.commands.setContent("Link sample.");
    });
    expect(captured.emitted.at(-1)).toBe("Link sample.");

    act(() =>
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: "[Link](https://example.com/server) sample.",
          contentUpdatedAt: "2024-01-01T00:00:02.000Z",
          initialAppliedUpdatedAt: null,
        }),
      ),
    );
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe(
      "[Link](https://example.com/server) sample.",
    );
  });

  it("still reconciles a changed authority revision when its timestamp ties", async () => {
    const canonical = "Alpha\n\nBravo";
    const { captured, Harness } = makeCollabSeedHarness(canonical);
    act(() =>
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: canonical,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          contentRevision: "revision-1",
          initialAppliedUpdatedAt: null,
        }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    act(() => {
      captured.editor!.commands.setContent("Alpha local\n\nBravo");
    });
    expect(captured.emitted.at(-1)).toBe("Alpha local\n\nBravo");

    act(() =>
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: "Alpha\n\nBravo server",
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          contentRevision: "revision-2",
          initialAppliedUpdatedAt: null,
        }),
      ),
    );
    await flush();

    expect(captured.reconciled).toEqual([
      {
        status: "merged",
        content: "Alpha local\n\nBravo server",
      },
    ]);
    expect(getEditorMarkdown(captured.editor!)).toBe(
      "Alpha local\n\nBravo server",
    );
  });

  it("still clears a stale collab value when there is no local emission", async () => {
    const { captured, Harness } = makeCollabSeedHarness("stale persisted body");
    act(() =>
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: "canonical SQL body",
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          initialAppliedUpdatedAt: null,
        }),
      ),
    );
    expect(getEditorMarkdown(captured.editor!)).toBe("stale persisted body");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(getEditorMarkdown(captured.editor!)).toBe("canonical SQL body");
    expect(captured.emitted).toEqual([]);
  });

  it("uses the collaborative seed as the base for a later three-way merge", async () => {
    const { captured, Harness } = makeCollabSeedHarness();
    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 0,
          value: "Alpha\n\nBravo\n\nCharlie",
          contentRevision: "revision-1",
        }),
      );
    });
    await flush();

    act(() =>
      captured.editor!.commands.setContent("Alpha local\n\nBravo\n\nCharlie"),
    );
    act(() => {
      root.render(
        React.createElement(Harness, {
          collabSynced: true,
          fragmentLength: 1,
          value: "Alpha\n\nBravo\n\nCharlie server",
          contentRevision: "revision-2",
          contentUpdatedAt: "2024-01-01T00:00:02.000Z",
        }),
      );
    });
    await flush();

    expect(captured.reconciled).toEqual([
      {
        status: "merged",
        content: "Alpha local\n\nBravo\n\nCharlie server",
      },
    ]);
    expect(getEditorMarkdown(captured.editor!)).toBe(
      "Alpha local\n\nBravo\n\nCharlie server",
    );
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

  it("does not roll back a blurred local mark while its controlled echo is queued", async () => {
    const { captured, Harness } = makeHarness();
    const canonical = "[Link](https://example.com/first) sample.";
    let editorFocused = false;
    const isEditorFocused = () => editorFocused;
    const props = {
      value: canonical,
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      isEditorFocused,
    };

    render(root, Harness, props);
    await flush();
    expect(captured.setContentCalls).toBe(0);

    act(() => {
      captured
        .editor!.chain()
        .setTextSelection({ from: 1, to: 5 })
        .unsetLink()
        .run();
    });
    const localDraft = captured.emitted.at(-1)!;
    expect(localDraft).toBe("Link sample.");

    // A sibling-state render can arrive before the host's deferred onChange.
    // The toolbar input still owns focus when reconcile observes the stale
    // controlled value; editor focus returns before its timer applies.
    render(root, Harness, props);
    editorFocused = true;
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe(localDraft);
    expect(captured.setContentCalls).toBe(0);

    render(root, Harness, { ...props, value: localDraft });
    await flush();
    expect(getEditorMarkdown(captured.editor!)).toBe(localDraft);
  });

  it("persists a non-lead client's own local edit to a nonempty shared document", async () => {
    // Losing the lead election only bars this client from SEEDING. Its own
    // typing still has to reach the app's persist path, or the text lives in
    // the CRDT alone and the next lead mount overwrites it with the SQL body.
    const persistedYdoc = new Y.Doc();
    const persistedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: persistedYdoc,
      }),
    });
    persistedEditor.commands.setContent("shared body");
    const liveYdoc = new Y.Doc();
    Y.applyUpdate(liveYdoc, Y.encodeStateAsUpdate(persistedYdoc), "remote");
    persistedEditor.destroy();
    persistedYdoc.destroy();

    liveYdoc.clientID = 500;
    const awareness = new Awareness(liveYdoc);
    awareness
      .getStates()
      .set(1, { user: { name: "Lead peer" }, visible: true });

    const emitted: string[] = [];
    let capturedEditor: Editor | null = null;

    function Probe() {
      const guardsRef = React.useRef<ReturnType<
        typeof useCollabReconcile
      > | null>(null);
      const editor = useEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: liveYdoc,
        }),
        onUpdate: ({ editor, transaction }) => {
          const guards = guardsRef.current;
          if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
          const markdown = getEditorMarkdown(editor);
          if (!guards.registerEmitted(markdown)) return;
          emitted.push(markdown);
        },
      });
      capturedEditor = editor;
      guardsRef.current = useCollabReconcile({
        editor,
        ydoc: liveYdoc,
        awareness,
        collabSynced: true,
        value: "shared body",
        contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        editable: true,
      });
      return React.createElement("div", null);
    }

    act(() => root.render(React.createElement(Probe)));
    await flush();

    act(() => {
      capturedEditor!.view.dispatch(
        capturedEditor!.state.tr
          .insertText(
            " plus my edit",
            capturedEditor!.state.doc.content.size - 1,
          )
          .setMeta("uiEvent", "input"),
      );
    });

    expect(emitted.at(-1)).toContain("plus my edit");
    awareness.destroy();
    liveYdoc.destroy();
  });

  it("does not reapply a partial save echo while an external editor control owns focus", async () => {
    const { captured, Harness } = makeHarness();

    render(root, Harness, {
      value: "# abcdef",
      contentUpdatedAt: "2024-01-01T00:00:01.000Z",
      editorOwnedFocus: true,
    });
    await flush();

    act(() => captured.editor!.commands.setContent("# abcde"));
    act(() => captured.editor!.commands.setContent("# ab"));
    expect(getEditorMarkdown(captured.editor!)).toBe("# ab");

    render(root, Harness, {
      value: "# abcde",
      contentUpdatedAt: "2024-01-01T00:00:02.000Z",
      editorOwnedFocus: true,
    });
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("# ab");

    render(root, Harness, {
      value: "# updated externally",
      contentUpdatedAt: "2024-01-01T00:00:03.000Z",
      editorOwnedFocus: false,
    });
    await flush();

    expect(getEditorMarkdown(captured.editor!)).toBe("# updated externally");
  });
});
