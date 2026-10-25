// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { applyDocSurgically, defaultParseValue } from "./surgical-apply.js";
import {
  getEditorMarkdown,
  useCollabReconcile,
  type UseCollabReconcileOptions,
} from "./useCollabReconcile.js";

type AdoptionRequest = Parameters<
  NonNullable<UseCollabReconcileOptions["requestSnapshotAdoption"]>
>[0];
type AdoptionResult = Awaited<
  ReturnType<NonNullable<UseCollabReconcileOptions["requestSnapshotAdoption"]>>
>;

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
  setVisibility("visible");
  container.remove();
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

const BASELINE = "Alpha paragraph.\n\nBravo paragraph.";
const OUTSIDE = "Alpha paragraph.\n\nOutside paragraph.\n\nBravo paragraph.";

/**
 * Tabs that share a page through a server doc. Each tab's own updates wait in
 * an outbox, as a throttled background tab's debounced push does, until
 * `push` sends them; the server relays what it takes in to the other tabs.
 */
function makeTabs(
  count: number,
  options: { visible: boolean; adoption: "server" | "none" },
) {
  const server = new Y.Doc();
  const seedEditor = new CoreEditor({
    extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: server }),
  });
  seedEditor.commands.setContent(BASELINE);
  seedEditor.destroy();

  const docs = Array.from({ length: count }, (_, index) => {
    const doc = new Y.Doc();
    doc.clientID = index + 1;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), "remote");
    return doc;
  });
  const outboxes: Uint8Array[][] = docs.map(() => []);
  docs.forEach((doc, index) => {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") outboxes[index]!.push(update);
    });
  });
  // Holds back the server's relay, as for a revision another server took in
  // that has not reached the tabs yet.
  let relayPaused = false;
  server.on("update", (update: Uint8Array, origin: unknown) => {
    if (relayPaused) return;
    docs.forEach((doc, index) => {
      if (origin !== `tab-${index}`) Y.applyUpdate(doc, update, "remote");
    });
  });
  const push = (index: number) => {
    for (const update of outboxes[index]!.splice(0)) {
      Y.applyUpdate(server, update, `tab-${index}`);
    }
  };

  const awareness = docs.map((doc) => {
    const state = new Awareness(doc);
    docs.forEach((_, peer) => {
      state.getStates().set(peer + 1, {
        user: { name: `Tab ${peer + 1}` },
        visible: options.visible,
        canFlushDocument: true,
      });
    });
    return state;
  });

  let savedRevision = "revision-1";
  // Saved bodies by revision, as the server reads them when it adopts one.
  const bodies = new Map<string, string>();
  let rebaseWithoutRevision = false;
  let lostAnswers = 0;
  let failuresLeft = 0;
  let failureStatus = 503;
  const adoptionCalls: Array<{ index: number; revision: string }> = [];
  const pendingAdoptions: Array<() => void> = [];
  const heldTabs = new Set<number>();
  const heldAnswers: Array<() => void> = [];
  // The server's half, as `adoptSnapshotOnce` does it: one adoption per
  // revision, and none from a proposal built before another revision landed.
  const adopt = (index: number, request: AdoptionRequest) =>
    new Promise<AdoptionResult>((settled, rejected) => {
      adoptionCalls.push({ index, revision: request.revision });
      // The saved body may move on after the server checks it.
      const savedAtCheck = savedRevision;
      const deliver = (send: () => void) =>
        heldTabs.has(index) ? heldAnswers.push(send) : send();
      const resolve = (result: AdoptionResult) =>
        deliver(() => settled(result));
      const reject = (error: unknown) => deliver(() => rejected(error));
      pendingAdoptions.push(() => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          reject(
            Object.assign(new Error("unavailable"), { status: failureStatus }),
          );
          return;
        }
        const marker = server.getMap("agentNativeSnapshotAdoption");
        if (rebaseWithoutRevision) {
          resolve({
            status: "rebase",
            adoptedRevision: null,
            state: Y.encodeStateAsUpdate(server),
          });
          return;
        }
        const adopted = (marker.get("revision") as string | undefined) ?? null;
        const proposal = new Y.Doc();
        Y.applyUpdate(proposal, request.update);
        const base =
          (proposal.getMap("agentNativeSnapshotAdoption").get("revision") as
            | string
            | undefined) ?? null;
        // Whether the proposal was built on everything the server holds.
        const merged = new Y.Doc();
        Y.applyUpdate(merged, request.update);
        Y.applyUpdate(merged, Y.encodeStateAsUpdate(server));
        const current = Y.equalSnapshots(
          Y.snapshot(merged),
          Y.snapshot(proposal),
        );
        merged.destroy();
        proposal.destroy();
        const answer = (status: AdoptionResult["status"]) =>
          resolve({
            status,
            adoptedRevision: adopted,
            adoptedBody: (marker.get("body") as string | undefined) ?? null,
            state: Y.encodeStateAsUpdate(server),
          });
        if (adopted === request.revision) return answer("already-adopted");
        if (adopted !== base || !current) return answer("rebase");
        if (request.revision !== savedAtCheck) return answer("stale");
        server.transact(() => {
          Y.applyUpdate(server, request.update);
          marker.set("revision", request.revision);
          marker.set("body", bodies.get(request.revision)!);
        }, "adoption");
        if (lostAnswers > 0) {
          lostAnswers -= 1;
          reject(new Error("The answer was lost after the server took it"));
          return;
        }
        resolve({
          status: "adopted",
          adoptedRevision: request.revision,
          adoptedBody: bodies.get(request.revision)!,
          state: Y.encodeStateAsUpdate(server),
        });
      });
    });
  const settleAdoptions = () => {
    for (const settle of pendingAdoptions.splice(0)) settle();
  };

  const editors: Array<Editor | null> = docs.map(() => null);
  const reconciled: Array<{ status: string; baseRevision: string }> = [];
  let extraOptions: Partial<UseCollabReconcileOptions> = {};
  const tabOptions = new Map<number, Partial<UseCollabReconcileOptions>>();
  function Tab({
    index,
    value,
    revision,
    updatedAt,
  }: {
    index: number;
    value: string;
    revision: string;
    updatedAt: string;
  }) {
    const guardsRef = React.useRef<ReturnType<
      typeof useCollabReconcile
    > | null>(null);
    const editor = useEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: docs[index],
      }),
      onUpdate: ({ transaction }) => {
        guardsRef.current?.shouldIgnoreUpdate(transaction);
      },
    });
    editors[index] = editor;
    const requestCollabSync = React.useCallback(async () => {
      Y.applyUpdate(
        docs[index]!,
        Y.encodeStateAsUpdate(server, Y.encodeStateVector(docs[index]!)),
        "remote",
      );
      return { status: "synced" as const };
    }, [index]);
    const requestSnapshotAdoption = React.useCallback(
      (request: AdoptionRequest) => adopt(index, request),
      [index],
    );
    guardsRef.current = useCollabReconcile({
      editor,
      ydoc: docs[index],
      awareness: awareness[index],
      collabSynced: true,
      value,
      contentUpdatedAt: updatedAt,
      contentRevision: revision,
      requestCollabSync,
      requestSnapshotAdoption:
        options.adoption === "server" ? requestSnapshotAdoption : undefined,
      onBaseAwareReconcile: (result) =>
        reconciled.push({
          status: result.status,
          baseRevision: result.baseRevision,
        }),
      getMarkdown: (editorToRead) => getEditorMarkdown(editorToRead),
      initialAppliedUpdatedAt: null,
      overlapPolicy: "prefer-live",
      editable: true,
      ...extraOptions,
      ...tabOptions.get(index),
    });
    return React.createElement("div");
  }
  const renderEach = (
    props: Array<{ value: string; revision: string; updatedAt: string }>,
  ) =>
    act(() => {
      props.forEach((tab) => bodies.set(tab.revision, tab.value));
      root.render(
        React.createElement(
          React.Fragment,
          null,
          ...docs.map((_, index) =>
            React.createElement(Tab, { ...props[index]!, index, key: index }),
          ),
        ),
      );
    });
  const render = (props: {
    value: string;
    revision: string;
    updatedAt: string;
  }) =>
    act(() => {
      bodies.set(props.revision, props.value);
      root.render(
        React.createElement(
          React.Fragment,
          null,
          ...docs.map((_, index) =>
            React.createElement(Tab, { ...props, index, key: index }),
          ),
        ),
      );
    });

  return {
    render,
    push,
    settleAdoptions,
    renderEach,
    settleOneAdoption: () => pendingAdoptions.shift()?.(),
    settleLastAdoption: () => pendingAdoptions.pop()?.(),
    setTabOptions: (
      index: number,
      next: Partial<UseCollabReconcileOptions>,
    ) => {
      tabOptions.set(index, next);
    },
    deleteFirstParagraph: (index: number) =>
      act(() => {
        const editor = editors[index]!;
        editor.commands.deleteRange({
          from: 0,
          to: editor.state.doc.child(0).nodeSize,
        });
      }),
    /** Sends a tab's updates to the server without the server relaying them. */
    pushUnrelayed: (index: number) => {
      relayPaused = true;
      try {
        push(index);
      } finally {
        relayPaused = false;
      }
    },
    adoptionCalls,
    reconciled,
    setOptions: (next: Partial<UseCollabReconcileOptions>) => {
      extraOptions = next;
    },
    /** Types at the start of the first paragraph without pushing it. */
    type: (index: number, text: string) =>
      act(() => {
        editors[index]!.commands.insertContentAt(1, text);
      }),
    rebaseWithoutRevision: () => {
      rebaseWithoutRevision = true;
    },
    loseNextAnswer: () => {
      lostAnswers += 1;
    },
    /** Another editor's adoption of `revision`, which no tab has yet. */
    adoptElsewhere: (value: string, revision: string) => {
      bodies.set(revision, value);
      relayPaused = true;
      const writer = new CoreEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: server,
        }),
      });
      try {
        server.transact(() => {
          applyDocSurgically(
            writer as unknown as Editor,
            defaultParseValue(writer as unknown as Editor, value)!,
          );
          const marker = server.getMap("agentNativeSnapshotAdoption");
          marker.set("revision", revision);
          marker.set("body", value);
        }, "elsewhere");
      } finally {
        writer.destroy();
        relayPaused = false;
      }
    },
    holdAnswersFor: (index: number) => heldTabs.add(index),
    deliverHeldAnswers: () => {
      heldTabs.clear();
      for (const send of heldAnswers.splice(0)) send();
    },
    failNextAdoptions: (count: number, status = 503) => {
      failuresLeft = count;
      failureStatus = status;
    },
    saveRevision: (revision: string) => {
      savedRevision = revision;
    },
    markdown: () => editors.map((editor) => getEditorMarkdown(editor!)),
    serverMarkdown: () => {
      const reader = new CoreEditor({
        extensions: createRichMarkdownExtensions({
          dialect: "gfm",
          ydoc: server,
        }),
      });
      try {
        return getEditorMarkdown(reader as unknown as Editor);
      } finally {
        reader.destroy();
      }
    },
    dispose: () => {
      act(() => root.unmount());
      root = createRoot(container);
      awareness.forEach((state) => state.destroy());
      docs.forEach((doc) => doc.destroy());
      server.destroy();
    },
  };
}

const FIRST = {
  value: BASELINE,
  revision: "revision-1",
  updatedAt: "2024-01-01T00:00:01.000Z",
};
const SECOND = {
  value: OUTSIDE,
  revision: "revision-2",
  updatedAt: "2024-01-01T00:00:02.000Z",
};

describe("useCollabReconcile — snapshot adoption", () => {
  it.each([
    ["the lead tab's push lags", true],
    ["every tab is in the background", false],
  ])(
    "keeps one copy of an outside write when two tabs both take it in (%s)",
    async (_case, visible) => {
      vi.useFakeTimers();
      if (!visible) setVisibility("hidden");
      const tabs = makeTabs(2, { visible, adoption: "server" });
      try {
        tabs.render(FIRST);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        expect(tabs.markdown()).toEqual([BASELINE, BASELINE]);

        tabs.saveRevision(SECOND.revision);
        tabs.render(SECOND);
        // Past the lead's settle wait and the other tab's failover, with
        // neither tab's push or proposal through yet.
        await act(async () => vi.advanceTimersByTimeAsync(8000));
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(8000));
        tabs.settleAdoptions();
        tabs.push(0);
        tabs.push(1);
        await act(async () => vi.advanceTimersByTimeAsync(8000));

        expect(tabs.markdown()).toEqual([OUTSIDE, OUTSIDE]);
        expect(tabs.serverMarkdown()).toBe(OUTSIDE);
      } finally {
        tabs.dispose();
      }
    },
  );

  it("takes an outside write into a single background tab once", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const tabs = makeTabs(1, { visible: false, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));

      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      // The same snapshot again, as a refetch delivers it.
      tabs.render({ ...SECOND });
      await act(async () => vi.advanceTimersByTimeAsync(8000));
      tabs.settleAdoptions();
      tabs.push(0);
      await act(async () => vi.advanceTimersByTimeAsync(100));

      expect(tabs.adoptionCalls).toEqual([
        { index: 0, revision: "revision-2" },
      ]);
      expect(tabs.markdown()).toEqual([OUTSIDE]);
      expect(tabs.serverMarkdown()).toBe(OUTSIDE);
    } finally {
      tabs.dispose();
    }
  });

  it("leaves a snapshot the server calls stale for the newer one", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.saveRevision("revision-3");
      tabs.render(SECOND);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown()).toEqual([BASELINE]);

      const third = "Alpha paragraph.\n\nThird paragraph.\n\nBravo paragraph.";
      tabs.render({
        value: third,
        revision: "revision-3",
        updatedAt: "2024-01-01T00:00:03.000Z",
      });
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown()).toEqual([third]);
    } finally {
      tabs.dispose();
    }
  });

  it("keeps retrying instead of applying a snapshot itself while the server fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs(2, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.failNextAdoptions(8);
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      for (let step = 0; step < 12; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(4000));
        if (step < 6) {
          // Neither tab puts its own copy in while the server is down.
          expect(tabs.markdown()).toEqual([BASELINE, BASELINE]);
        }
        tabs.settleAdoptions();
      }
      tabs.push(0);
      tabs.push(1);
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(tabs.markdown()).toEqual([OUTSIDE, OUTSIDE]);
      expect(tabs.serverMarkdown()).toBe(OUTSIDE);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      tabs.dispose();
    }
  });

  it.each([
    ["every server lacks it", 2],
    ["only one tab's server lacks it", 1],
  ])(
    "keeps one copy when a server has no adoptions (%s)",
    async (_case, missing) => {
      vi.useFakeTimers();
      setVisibility("hidden");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tabs = makeTabs(2, { visible: false, adoption: "server" });
      try {
        tabs.render(FIRST);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        tabs.failNextAdoptions(missing, 404);
        tabs.saveRevision(SECOND.revision);
        tabs.render(SECOND);
        await act(async () => vi.advanceTimersByTimeAsync(8000));
        expect(tabs.adoptionCalls).toHaveLength(2);
        // The first answer is the 404; neither tab applies the snapshot
        // itself while the other's proposal is still out.
        tabs.settleOneAdoption();
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.markdown()).toEqual([BASELINE, BASELINE]);
        for (let step = 0; step < 4; step += 1) {
          tabs.settleAdoptions();
          await act(async () => vi.advanceTimersByTimeAsync(3000));
        }
        tabs.push(0);
        tabs.push(1);
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.markdown()).toEqual([OUTSIDE, OUTSIDE]);
        expect(tabs.serverMarkdown()).toBe(OUTSIDE);
      } finally {
        warn.mockRestore();
        tabs.dispose();
      }
    },
  );

  it("asks again, without a second copy, when an answer is lost after the server took it", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.loseNextAnswer();
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(1100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.push(0);
      expect(tabs.adoptionCalls).toHaveLength(2);
      expect(tabs.markdown()).toEqual([OUTSIDE]);
      expect(tabs.serverMarkdown()).toBe(OUTSIDE);
    } finally {
      tabs.dispose();
    }
  });

  it("keeps unsaved typing when it rebuilds on a revision this tab never saw", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    const third = {
      value: `${OUTSIDE}\n\nLater paragraph.`,
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.type(0, "Unsaved ");
      tabs.saveRevision(third.revision);
      tabs.render(third);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.adoptionCalls).toHaveLength(1);
      tabs.adoptElsewhere(OUTSIDE, SECOND.revision);
      for (let step = 0; step < 3; step += 1) {
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(100));
      }
      expect(tabs.adoptionCalls.map((call) => call.revision)).toEqual([
        "revision-3",
        "revision-3",
      ]);
      expect(tabs.markdown()).toEqual([`Unsaved ${third.value}`]);
    } finally {
      tabs.dispose();
    }
  });

  it("stops when the server keeps sending a proposal back without a revision to rebuild on", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.rebaseWithoutRevision();
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      for (let step = 0; step < 30; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(5));
        tabs.settleAdoptions();
      }
      await act(async () => vi.advanceTimersByTimeAsync(5));
      expect(tabs.adoptionCalls).toHaveLength(1);
      expect(tabs.markdown()).toEqual([BASELINE]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      tabs.dispose();
    }
  });

  it("backs off, then takes the write in, while other editors' adoptions keep landing first", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      for (let step = 0; step < 10; step += 1) {
        tabs.adoptElsewhere(
          `${BASELINE}\n\nElsewhere ${step}.`,
          `elsewhere-${step}`,
        );
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(100));
      }
      // The first proposal, three rebuilds at once, then one backed off.
      expect(tabs.adoptionCalls.length).toBeLessThanOrEqual(5);
      for (let step = 0; step < 4; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        tabs.settleAdoptions();
      }
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown()).toEqual([OUTSIDE]);
    } finally {
      tabs.dispose();
    }
  });

  it("plans on an adoption that reached the doc through sync", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    const third = {
      value: `Alpha paragraph.\n\nOutside paragraph.\n\nLater paragraph.\n\nBravo paragraph.`,
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      // Revision 2 is taken in elsewhere; this tab only catches up to it
      // while it handles revision 3.
      tabs.adoptElsewhere(OUTSIDE, SECOND.revision);
      tabs.saveRevision(third.revision);
      tabs.render(third);
      for (let step = 0; step < 4; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        tabs.settleAdoptions();
      }
      expect(tabs.markdown()).toEqual([third.value]);
      expect(tabs.reconciled).toEqual([]);
    } finally {
      tabs.dispose();
    }
  });

  it.each([
    ["before the proposal", true],
    ["while the proposal is out", false],
  ])(
    "keeps typing made %s in a paragraph the snapshot removes",
    async (_case, typedFirst) => {
      vi.useFakeTimers();
      const tabs = makeTabs(1, { visible: true, adoption: "server" });
      const second = { ...SECOND, value: "Bravo paragraph." };
      try {
        tabs.render(FIRST);
        await act(async () => vi.advanceTimersByTimeAsync(30));
        if (typedFirst) tabs.type(0, "Unsaved ");
        tabs.saveRevision(second.revision);
        tabs.render(second);
        await act(async () => vi.advanceTimersByTimeAsync(100));
        // Typed first, the typing wins over the removal outright.
        expect(tabs.adoptionCalls).toHaveLength(typedFirst ? 0 : 1);
        if (!typedFirst) tabs.type(0, "Unsaved ");
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(100));
        tabs.push(0);
        expect(tabs.markdown()).toEqual([
          "Unsaved Alpha paragraph.\n\nBravo paragraph.",
        ]);
        expect(tabs.serverMarkdown()).toBe(
          "Unsaved Alpha paragraph.\n\nBravo paragraph.",
        );
      } finally {
        tabs.dispose();
      }
    },
  );

  it("rebuilds on another editor's adoption of the revision this tab saved itself", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs(2, { visible: true, adoption: "server" });
    const ownSave = {
      value: "Bravo paragraph.",
      revision: "revision-2",
      updatedAt: SECOND.updatedAt,
    };
    const outside = {
      value: "Bravo paragraph.\n\nOutside paragraph.",
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      // Tab 1 deletes a paragraph and saves it as revision 2; tab 2 never
      // hears of the deletion and proposes revision 2 itself.
      tabs.deleteFirstParagraph(0);
      tabs.pushUnrelayed(0);
      tabs.setTabOptions(0, {
        acknowledgedLocalSnapshot: { ...ownSave, sequence: 1 },
      });
      tabs.setTabOptions(1, {
        requestCollabSync: async () => ({ status: "failed" as const }),
      });
      tabs.saveRevision(ownSave.revision);
      tabs.render(ownSave);
      await act(async () => vi.advanceTimersByTimeAsync(12_000));
      expect(tabs.adoptionCalls).toEqual([
        { index: 1, revision: "revision-2" },
      ]);
      // Revision 3 is proposed by tab 1 with its own save as the base, and
      // tab 2's revision 2 lands first.
      tabs.saveRevision(outside.revision);
      tabs.renderEach([outside, ownSave]);
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      for (let step = 0; step < 4; step += 1) {
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(3000));
      }
      expect(tabs.markdown()[0]).toBe(outside.value);
      expect(tabs.serverMarkdown()).toBe(outside.value);
    } finally {
      warn.mockRestore();
      tabs.dispose();
    }
  });

  it("does not put typing in twice when a tab that missed it proposes the write that kept it", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs(2, { visible: true, adoption: "server" });
    const ownSave = {
      value: `Saved ${BASELINE}`,
      revision: "revision-2",
      updatedAt: SECOND.updatedAt,
    };
    const outside = {
      value: `Saved ${OUTSIDE}`,
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      // The typing reaches the server before its save; only the relay to
      // tab 2 is late, and tab 2 cannot catch up.
      tabs.type(0, "Saved ");
      tabs.pushUnrelayed(0);
      expect(tabs.markdown()).toEqual([ownSave.value, BASELINE]);
      tabs.setTabOptions(0, {
        acknowledgedLocalSnapshot: { ...ownSave, sequence: 1 },
      });
      tabs.setTabOptions(1, {
        requestCollabSync: async () => ({ status: "failed" as const }),
      });
      tabs.renderEach([ownSave, FIRST]);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.saveRevision(outside.revision);
      tabs.render(outside);
      await act(async () => vi.advanceTimersByTimeAsync(12_000));
      expect(tabs.adoptionCalls).toEqual([
        { index: 0, revision: "revision-3" },
        { index: 1, revision: "revision-3" },
      ]);
      // The lagging tab's proposal reaches the server first.
      tabs.settleLastAdoption();
      for (let step = 0; step < 4; step += 1) {
        tabs.settleAdoptions();
        await act(async () => vi.advanceTimersByTimeAsync(3000));
      }
      tabs.push(0);
      tabs.push(1);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown()).toEqual([outside.value, outside.value]);
      expect(tabs.serverMarkdown()).toBe(outside.value);
    } finally {
      warn.mockRestore();
      tabs.dispose();
    }
  });

  it("takes in the next write whole after a rebuild answer it no longer waits for", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    const second = { ...SECOND, value: `${BASELINE}\n\nOutside paragraph.` };
    const third = {
      value: `${second.value}\n\nLater paragraph.`,
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    const fourth = {
      value: `${third.value}\n\nNewest paragraph.`,
      revision: "revision-4",
      updatedAt: "2024-01-01T00:00:04.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      // Revision 2 arrives and is passed over for revision 3 at once.
      tabs.saveRevision(second.revision);
      tabs.render(second);
      tabs.saveRevision(third.revision);
      tabs.render(third);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.adoptionCalls).toEqual([
        { index: 0, revision: "revision-3" },
      ]);
      // Another editor takes in revision 2 first, so revision 3 comes back to
      // rebuild, but only once revision 4 has replaced it here.
      tabs.adoptElsewhere(second.value, second.revision);
      tabs.holdAnswersFor(0);
      tabs.settleAdoptions();
      tabs.saveRevision(fourth.revision);
      tabs.render(fourth);
      tabs.deliverHeldAnswers();
      for (let step = 0; step < 4; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        tabs.settleAdoptions();
      }
      expect(tabs.markdown()).toEqual([fourth.value]);
      expect(tabs.reconciled).toEqual([]);
    } finally {
      tabs.dispose();
    }
  });

  it("keeps one copy of each when a newer write lands while the first is being taken in", async () => {
    vi.useFakeTimers();
    const tabs = makeTabs(2, { visible: true, adoption: "server" });
    const third = {
      value:
        "Alpha paragraph.\n\nOutside paragraph.\n\nLater paragraph.\n\nBravo paragraph.",
      revision: "revision-3",
      updatedAt: "2024-01-01T00:00:03.000Z",
    };
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      // The lead tab proposes revision 2, and the server checks it is current.
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(tabs.adoptionCalls).toEqual([
        { index: 0, revision: "revision-2" },
      ]);
      tabs.holdAnswersFor(0);
      tabs.saveRevision(third.revision);
      tabs.render(third);
      // The other tab fails over and proposes revision 3 on the old doc.
      await act(async () => vi.advanceTimersByTimeAsync(8000));
      expect(tabs.adoptionCalls).toContainEqual({
        index: 1,
        revision: "revision-3",
      });
      // Revision 2 commits first; the stale proposal for revision 3 is sent
      // back, rebuilt, and taken in, all before the lead tab hears back.
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(tabs.markdown()[0]).toBe(third.value);
      expect(tabs.adoptionCalls).toEqual([
        { index: 0, revision: "revision-2" },
        { index: 1, revision: "revision-3" },
        { index: 1, revision: "revision-3" },
      ]);
      tabs.deliverHeldAnswers();
      for (let step = 0; step < 4; step += 1) {
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        tabs.settleAdoptions();
      }
      tabs.push(0);
      tabs.push(1);
      await act(async () => vi.advanceTimersByTimeAsync(3000));

      expect(tabs.markdown()).toEqual([third.value, third.value]);
      expect(tabs.serverMarkdown()).toBe(third.value);
      // The answer for revision 2 lands after revision 3 did, and is not
      // reported as a merge of revision 3's text against revision 1.
      expect(tabs.reconciled).toEqual([]);
    } finally {
      tabs.dispose();
    }
  });

  it("still takes in a newer body when another tab's seed of an older one wins", async () => {
    vi.useFakeTimers();
    const seeded = new Y.Doc();
    const seedEditor = new CoreEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: seeded,
      }),
    });
    seedEditor.commands.setContent(BASELINE);
    seedEditor.destroy();
    const olderSeed = Y.encodeStateAsUpdate(seeded);
    seeded.destroy();

    const doc = new Y.Doc();
    let releaseFirstSeed!: () => void;
    const requestInitialSeed = vi
      .fn<() => Promise<Uint8Array>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstSeed = () => resolve(olderSeed);
          }),
      )
      // The server already holds the first seed, so it returns that.
      .mockResolvedValue(olderSeed);
    const adoptions: AdoptionRequest[] = [];
    const requestSnapshotAdoption = vi.fn(async (request: AdoptionRequest) => {
      adoptions.push(request);
      return {
        status: "adopted" as const,
        adoptedRevision: request.revision,
        state: request.update,
      };
    });
    let editor: Editor | null = null;
    function Tab(props: typeof FIRST) {
      editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: doc }),
      });
      useCollabReconcile({
        editor,
        ydoc: doc,
        collabSynced: true,
        value: props.value,
        contentUpdatedAt: props.updatedAt,
        contentRevision: props.revision,
        requestInitialSeed,
        requestSnapshotAdoption,
        getMarkdown: (editorToRead) => getEditorMarkdown(editorToRead),
        initialAppliedUpdatedAt: null,
        editable: true,
      });
      return React.createElement("div");
    }
    try {
      act(() => root.render(React.createElement(Tab, FIRST)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      expect(requestInitialSeed).toHaveBeenCalledTimes(1);
      act(() => root.render(React.createElement(Tab, SECOND)));
      await act(async () => vi.advanceTimersByTimeAsync(30));
      releaseFirstSeed();
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(getEditorMarkdown(editor!)).toBe(OUTSIDE);
      expect(adoptions.map((request) => request.revision)).toEqual([
        "revision-2",
      ]);
    } finally {
      act(() => root.unmount());
      root = createRoot(container);
      doc.destroy();
    }
  });
});
