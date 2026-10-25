// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
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
  server.on("update", (update: Uint8Array, origin: unknown) => {
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
        const adopted = (marker.get("revision") as string | undefined) ?? null;
        const proposal = new Y.Doc();
        Y.applyUpdate(proposal, request.update);
        const base =
          (proposal.getMap("agentNativeSnapshotAdoption").get("revision") as
            | string
            | undefined) ?? null;
        proposal.destroy();
        const answer = (status: AdoptionResult["status"]) =>
          resolve({
            status,
            adoptedRevision: adopted,
            state: Y.encodeStateAsUpdate(server),
          });
        if (adopted === request.revision) return answer("already-adopted");
        if (adopted !== base) return answer("rebase");
        if (request.revision !== savedAtCheck) return answer("stale");
        server.transact(() => {
          Y.applyUpdate(server, request.update);
          marker.set("revision", request.revision);
        }, "adoption");
        resolve({
          status: "adopted",
          adoptedRevision: request.revision,
          state: Y.encodeStateAsUpdate(server),
        });
      });
    });
  const settleAdoptions = () => {
    for (const settle of pendingAdoptions.splice(0)) settle();
  };

  const editors: Array<Editor | null> = docs.map(() => null);
  const reconciled: Array<{ status: string; baseRevision: string }> = [];
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
      editable: true,
    });
    return React.createElement("div");
  }
  const render = (props: {
    value: string;
    revision: string;
    updatedAt: string;
  }) =>
    act(() => {
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
    adoptionCalls,
    reconciled,
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

  it("applies a snapshot itself, with a warning, when the server has no adoptions", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs(1, { visible: true, adoption: "server" });
    try {
      tabs.render(FIRST);
      await act(async () => vi.advanceTimersByTimeAsync(30));
      tabs.failNextAdoptions(1, 404);
      tabs.saveRevision(SECOND.revision);
      tabs.render(SECOND);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      tabs.settleAdoptions();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown()).toEqual([OUTSIDE]);
      expect(tabs.adoptionCalls).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
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
