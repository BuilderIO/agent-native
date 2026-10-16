// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { AGENT_CLIENT_ID } from "../collab-ui/index.js";
import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { getEditorMarkdown, useCollabReconcile } from "./useCollabReconcile.js";

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
  vi.restoreAllMocks();
  container.remove();
});

const ORIGINAL = "Alpha paragraph.\n\nBravo paragraph.";
const WORD = "zq1723A1x";
const SAVED = `Alpha paragraph. ${WORD}\n\nBravo paragraph.`;
const CHARLIE = "Charlie paragraph.";

interface Snapshot {
  value: string;
  revision: string;
  updatedAt: string;
}

// Content's body revisions: a counter, then a hash the order ignores.
const STORED: Snapshot = {
  value: ORIGINAL,
  revision: "body:0:a",
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const ACKNOWLEDGED: Snapshot = {
  value: SAVED,
  revision: "body:1:b",
  updatedAt: "2024-01-01T00:00:05.000Z",
};
const AGENT_EDIT: Snapshot = {
  value: `${ORIGINAL}\n\n${CHARLIE}`,
  revision: "body:2:c",
  updatedAt: "2024-01-01T00:00:09.000Z",
};

function compareRevisions(first: string, second: string): number {
  const counter = (revision: string) => Number(revision.split(":")[1]);
  return Math.sign(counter(first) - counter(second));
}

type DiscoveryStatus = "ready" | "failed" | "unavailable";
type PeerState = {
  user?: { name: string };
  visible?: boolean;
  canFlushDocument?: boolean;
  reconciledRevision?: string;
};

function occurrences(markdown: string, text = WORD): number {
  return markdown.split(text).length - 1;
}

function heldRevision(awareness: Awareness): unknown {
  return awareness.getLocalState()?.reconciledRevision;
}

function peer(name: string, reconciledRevision?: string): PeerState {
  return {
    user: { name },
    visible: true,
    canFlushDocument: true,
    ...(reconciledRevision ? { reconciledRevision } : {}),
  };
}

/** The Yjs state a client's seed of `markdown` writes. */
function seedState(markdown: string): Uint8Array {
  const doc = new Y.Doc();
  const editor = new CoreEditor({
    extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: doc }),
  });
  editor.commands.setContent(markdown);
  const state = Y.encodeStateAsUpdate(doc);
  editor.destroy();
  doc.destroy();
  return state;
}

/**
 * Three tabs on one live doc, relayed as the server relays delivered updates.
 * A only types, as a tab whose save is in flight does, and reports no
 * revision. B was already open and runs the hook. C opens mid-save.
 */
function makeTabs({
  joinsOnPeers = true,
  ids = { A: 1, B: 2, C: 3 },
}: {
  joinsOnPeers?: boolean;
  ids?: { A: number; B: number; C: number };
} = {}) {
  const docs = { A: new Y.Doc(), B: new Y.Doc(), C: new Y.Doc() };
  docs.A.clientID = ids.A;
  docs.B.clientID = ids.B;
  docs.C.clientID = ids.C;
  const connected = new Set<Y.Doc>([docs.A, docs.B]);
  for (const doc of Object.values(docs)) {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "relay" || !connected.has(doc)) return;
      for (const other of connected)
        if (other !== doc) Y.applyUpdate(other, update, "relay");
    });
  }
  const author = new CoreEditor({
    extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: docs.A }),
  });
  author.commands.setContent(ORIGINAL);

  const awareness = { B: new Awareness(docs.B), C: new Awareness(docs.C) };
  awareness.B.setLocalState(peer("B"));
  awareness.C.setLocalState(peer("C"));
  awareness.B.getStates().set(ids.A, peer("A"));

  // B's updates reach the server unless its delivery is held.
  let deliveryHeld = false;
  const flush = {
    B: () =>
      deliveryHeld ? new Promise<boolean>(() => {}) : Promise.resolve(true),
    C: () => Promise.resolve(true),
  };
  /** C's first sync: it fetches the live doc, then joins the relay. */
  const syncC = () => {
    Y.applyUpdate(docs.C, Y.encodeStateAsUpdate(docs.A), "relay");
    connected.add(docs.C);
  };
  let catchUpStatus: "synced" | "failed" = "synced";
  let holdNextCatchUp = false;
  let releaseCatchUp: (() => void) | null = null;
  const catchUp = {
    B: vi.fn(async () => ({ status: "synced" as const })),
    // A held catch-up answers with the doc as the server had it when it was
    // asked, so it brings nothing new; any other brings what C missed.
    C: vi.fn(async () => {
      if (holdNextCatchUp) {
        holdNextCatchUp = false;
        await new Promise<void>((resolve) => {
          releaseCatchUp = resolve;
        });
      } else if (catchUpStatus === "synced" && !connected.has(docs.C)) {
        syncC();
      }
      return { status: catchUpStatus };
    }),
  };
  const remoteReports = { B: vi.fn(), C: vi.fn() };
  const saves = { B: vi.fn(), C: vi.fn() };
  let settleDiscovery: ((status: DiscoveryStatus) => void) | null = null;
  const discover = {
    B: async () => ({ status: "ready" as const }),
    C: vi.fn(
      () =>
        new Promise<{ status: DiscoveryStatus }>((resolve) => {
          settleDiscovery = (status) => resolve({ status });
        }),
    ),
  };

  const editors: { B: Editor | null; C: Editor | null } = { B: null, C: null };
  const results: {
    B: ReturnType<typeof useCollabReconcile> | null;
    C: ReturnType<typeof useCollabReconcile> | null;
  } = { B: null, C: null };
  function Tab({ name, snapshot }: { name: "B" | "C"; snapshot: Snapshot }) {
    // Wired as Content's editor wires them.
    const editor = useEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: docs[name],
      }),
      onUpdate: ({ editor: updated, transaction }) => {
        const result = results[name];
        result?.reportRemoteUpdate(transaction);
        if (!result || result.shouldIgnoreUpdate(transaction)) return;
        saves[name](getEditorMarkdown(updated));
      },
    });
    editors[name] = editor;
    results[name] = useCollabReconcile({
      editor,
      ydoc: docs[name],
      awareness: awareness[name],
      collabSynced: true,
      value: snapshot.value,
      contentRevision: snapshot.revision,
      contentUpdatedAt: snapshot.updatedAt,
      compareContentRevisions: compareRevisions,
      ...(joinsOnPeers
        ? {
            discoverCollabPeers: discover[name],
            flushCollabUpdates: flush[name],
            requestCollabSync: catchUp[name],
          }
        : {}),
      initialAppliedUpdatedAt: null,
      overlapPolicy: "prefer-live",
      onBaseAwareReconcile: () => {},
      onRemoteSnapshotChange: remoteReports[name],
      editable: true,
    });
    return React.createElement("div");
  }
  function Tabs({
    snapshot,
    snapshotC = snapshot,
    withC,
  }: {
    snapshot: Snapshot;
    snapshotC?: Snapshot;
    withC: boolean;
  }) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Tab, { name: "B", snapshot }),
      withC
        ? React.createElement(Tab, { name: "C", snapshot: snapshotC })
        : null,
    );
  }

  return {
    Tabs,
    awareness,
    discover,
    catchUp,
    editors,
    results,
    remoteReports,
    saves,
    typeAsA: () => author.commands.insertContentAt(17, ` ${WORD}`),
    editAsA: (edit: (author: CoreEditor) => void) => edit(author),
    /** A's later edits reach the server and B but not yet C. */
    editAsAOutOfC: (edit: (author: CoreEditor) => void) => {
      connected.delete(docs.C);
      edit(author);
    },
    /** B's later updates stay queued in B, as when its update request hangs. */
    holdBDelivery: () => {
      deliveryHeld = true;
      connected.delete(docs.B);
    },
    failCatchUp: () => {
      catchUpStatus = "failed";
    },
    /** C's next catch-up waits for `releaseCatchUp`. */
    holdCatchUp: () => {
      holdNextCatchUp = true;
    },
    releaseCatchUp: () => releaseCatchUp?.(),
    /** A presence state C receives outside discovery, as its poll delivers it. */
    reportToC: (clientId: number, state: PeerState) => {
      awareness.C.getStates().set(clientId, state);
      awareness.C.emit("change", [
        { added: [], updated: [clientId], removed: [] },
        "remote",
      ]);
    },
    joinFailed: (name: "B" | "C") => results[name]?.joinEvidenceFailed,
    retryJoin: (name: "B" | "C") => results[name]?.retryJoinEvidence(),
    syncC,
    /**
     * C's presence request answers. By default C learns A, which reports no
     * revision, and B's awareness as it stands.
     */
    discoverPeers: (
      status: DiscoveryStatus = "ready",
      peers: Array<[number, PeerState]> = [
        [ids.A, peer("A")],
        [ids.B, awareness.B.getLocalState() as PeerState],
      ],
    ) => {
      if (status === "ready") {
        for (const [clientId, state] of peers)
          awareness.C.getStates().set(clientId, state);
        awareness.C.emit("change", [
          {
            added: peers.map(([clientId]) => clientId),
            updated: [],
            removed: [],
          },
          "remote",
        ]);
      }
      settleDiscovery?.(status);
    },
    markdown: (name: "A" | "B" | "C") =>
      name === "A"
        ? getEditorMarkdown(author)
        : getEditorMarkdown(editors[name]!),
    counts: () => ({
      A: occurrences(getEditorMarkdown(author)),
      B: occurrences(getEditorMarkdown(editors.B!)),
      C: editors.C ? occurrences(getEditorMarkdown(editors.C)) : null,
    }),
    dispose: () => {
      act(() => root.unmount());
      root = createRoot(container);
      author.destroy();
      awareness.B.destroy();
      awareness.C.destroy();
      for (const doc of Object.values(docs)) doc.destroy();
    },
  };
}

type Tabs = ReturnType<typeof makeTabs>;

/** B opens, A types, then C syncs and mounts while A's save is held. */
async function openCWhileASaves(
  tabs: Tabs,
  {
    snapshotB = STORED,
    snapshotC = STORED,
  }: { snapshotB?: Snapshot; snapshotC?: Snapshot } = {},
): Promise<void> {
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, { snapshot: snapshotB, withC: false }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  act(() => tabs.typeAsA());
  expect(tabs.counts()).toEqual({ A: 1, B: 1, C: null });

  tabs.syncC();
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, {
        snapshot: snapshotB,
        snapshotC,
        withC: true,
      }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(200));
}

describe("useCollabReconcile: a tab joining a live doc mid-save", () => {
  it("keeps another tab's unsaved word, and it appears once after that save lands", async () => {
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts(), "C deleted A's word as it opened").toEqual({
        A: 1,
        B: 1,
        C: 1,
      });
      expect(heldRevision(tabs.awareness.B)).toBe(STORED.revision);
      expect(tabs.catchUp.C).toHaveBeenCalled();
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);

      act(() =>
        root.render(
          React.createElement(tabs.Tabs, {
            snapshot: ACKNOWLEDGED,
            withC: true,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(tabs.counts(), "A's saved word is not there exactly once").toEqual(
        { A: 1, B: 1, C: 1 },
      );
      expect(heldRevision(tabs.awareness.B)).toBe(ACKNOWLEDGED.revision);
      expect(heldRevision(tabs.awareness.C)).toBe(ACKNOWLEDGED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("counts a collaborator that holds a newer revision by its order", async () => {
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, {
        snapshotB: { ...STORED, revision: "body:10:k" },
        snapshotC: { ...STORED, revision: "body:9:j" },
      });
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
    } finally {
      tabs.dispose();
    }
  });

  it("applies a stored body newer than any collaborator holds", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(occurrences(tabs.markdown("C"), CHARLIE)).toBe(1);
      expect(occurrences(tabs.markdown("A"), CHARLIE)).toBe(1);
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("reports a revision only once the server has the updates behind it", async () => {
    const tabs = makeTabs({ ids: { A: 3, B: 2, C: 1 } });
    vi.useFakeTimers();
    try {
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: STORED, withC: false }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(heldRevision(tabs.awareness.B)).toBe(STORED.revision);

      // B applies an agent edit, but the update carrying it never leaves B.
      tabs.holdBDelivery();
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, {
            snapshot: AGENT_EDIT,
            withC: false,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(occurrences(tabs.markdown("B"), CHARLIE)).toBe(1);
      expect(heldRevision(tabs.awareness.B)).toBe(STORED.revision);

      tabs.syncC();
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, {
            snapshot: AGENT_EDIT,
            withC: true,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(200));
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(
        occurrences(tabs.markdown("C"), CHARLIE),
        "C trusted a report the server could not back",
      ).toBe(1);
      expect(occurrences(tabs.markdown("A"), CHARLIE)).toBe(1);
    } finally {
      tabs.dispose();
    }
  });

  it("leaves the doc as it is, and reports it, when it cannot learn who else is open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.joinFailed("C")).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not learn who else holds this document"),
        expect.any(Error),
      );

      act(() => tabs.retryJoin("C"));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(tabs.discover.C).toHaveBeenCalledTimes(2);
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("leaves the doc as it is, and reports it, when it cannot catch up with the server", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    tabs.failCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.joinFailed("C")).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not learn who else holds this document"),
        expect.objectContaining({
          message: "Catching up with the server failed",
        }),
      );
    } finally {
      tabs.dispose();
    }
  });

  it("stops waiting for collaborators that never answer, and reports it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => vi.advanceTimersByTimeAsync(19_000));
      expect(tabs.joinFailed("C")).toBe(false);
      await act(async () => vi.advanceTimersByTimeAsync(4_000));
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.joinFailed("C")).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not learn who else holds this document"),
        expect.objectContaining({ message: "Timed out" }),
      );
    } finally {
      tabs.dispose();
    }
  });

  it("clears a failed join once the stored body catches up with the doc", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(true);

      act(() =>
        root.render(
          React.createElement(tabs.Tabs, {
            snapshot: ACKNOWLEDGED,
            withC: true,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(heldRevision(tabs.awareness.C)).toBe(ACKNOWLEDGED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("asks again while its collab doc is not connected yet", async () => {
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("unavailable"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.discover.C).toHaveBeenCalledTimes(2);
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("catches up again before it trusts a report that arrives while it catches up", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    tabs.holdCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      await act(async () => tabs.discoverPeers());
      // The server answered C's catch-up before the agent edit reached it, and
      // B's report of that edit reaches C before the answer does.
      act(() =>
        tabs.editAsAOutOfC((author) =>
          author.commands.insertContentAt(
            author.state.doc.content.size,
            `<p>${CHARLIE}</p>`,
          ),
        ),
      );
      act(() => tabs.reportToC(6, peer("B", AGENT_EDIT.revision)));
      await act(async () => tabs.releaseCatchUp());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.catchUp.C).toHaveBeenCalledTimes(2);
      expect(
        occurrences(tabs.markdown("C"), CHARLIE),
        "C trusted a report its catch-up did not cover",
      ).toBe(1);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("keeps the doc when a collaborator's first report arrives while it catches up", async () => {
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    tabs.holdCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      expect(heldRevision(tabs.awareness.B)).toBe(STORED.revision);
      // The presence C learns predates B's report; the report itself arrives
      // while C's catch-up is in flight.
      await act(async () =>
        tabs.discoverPeers("ready", [
          [2, peer("A")],
          [3, peer("B")],
        ]),
      );
      act(() =>
        tabs.reportToC(3, tabs.awareness.B.getLocalState() as PeerState),
      );
      await act(async () => tabs.releaseCatchUp());
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
    } finally {
      tabs.dispose();
    }
  });

  it("neither edits nor saves until it learns who else is open", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      const userEdit = () =>
        tabs.editors
          .C!.state.tr.insertText("typed ", 1)
          .setMeta("uiEvent", "input");
      const remoteEdit = () =>
        tabs.editAsA((author) => author.commands.insertContentAt(1, "remote "));

      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.results.C!.shouldIgnoreUpdate(userEdit())).toBe(true);
      act(remoteEdit);
      expect(tabs.remoteReports.C).not.toHaveBeenCalled();
      expect(tabs.saves.C).not.toHaveBeenCalled();

      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.results.C!.shouldIgnoreUpdate(userEdit())).toBe(true);
      act(remoteEdit);
      expect(tabs.remoteReports.C).not.toHaveBeenCalled();
      expect(tabs.saves.C).not.toHaveBeenCalled();

      act(() => tabs.retryJoin("C"));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
      expect(tabs.results.C!.shouldIgnoreUpdate(userEdit())).toBe(false);
      act(remoteEdit);
      expect(tabs.remoteReports.C).toHaveBeenCalledTimes(1);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
    } finally {
      tabs.dispose();
    }
  });

  it("clears a failed join once the doc moves to the stored body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(true);

      act(() =>
        tabs.editAsA((author) =>
          author.commands.deleteRange({ from: 17, to: 18 + WORD.length }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(tabs.markdown("C")).toBe(ORIGINAL);
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
    } finally {
      tabs.dispose();
    }
  });

  it("stops asking once it unmounts", async () => {
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: STORED, withC: false }),
        ),
      );
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(25_000));
      expect(tabs.catchUp.C).not.toHaveBeenCalled();
    } finally {
      tabs.dispose();
    }
  });

  it("ignores the revision an agent or a read-only viewer reports", async () => {
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () =>
        tabs.discoverPeers("ready", [
          [
            AGENT_CLIENT_ID,
            { user: { name: "Agent" }, reconciledRevision: STORED.revision },
          ],
          [
            4,
            {
              ...peer("Viewer", STORED.revision),
              canFlushDocument: false,
            },
          ],
        ]),
      );
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 0, B: 0, C: 0 });
    } finally {
      tabs.dispose();
    }
  });

  it("changes nothing for a caller that does not opt in", async () => {
    const tabs = makeTabs({ joinsOnPeers: false });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 0, B: 0, C: 0 });
      expect(tabs.discover.C).not.toHaveBeenCalled();
      expect(heldRevision(tabs.awareness.B)).toBeUndefined();
      expect(heldRevision(tabs.awareness.C)).toBeUndefined();
    } finally {
      tabs.dispose();
    }
  });
});

describe("useCollabReconcile: seeding an empty live doc", () => {
  function mountOpener(seededBody: string) {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(peer("Opener"));
    const discover = vi.fn(() => new Promise<never>(() => {}));
    let editor: Editor | null = null;
    function Opener() {
      editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc }),
      });
      useCollabReconcile({
        editor,
        ydoc,
        awareness,
        collabSynced: true,
        value: AGENT_EDIT.value,
        contentRevision: AGENT_EDIT.revision,
        contentUpdatedAt: AGENT_EDIT.updatedAt,
        compareContentRevisions: compareRevisions,
        discoverCollabPeers: discover,
        flushCollabUpdates: () => Promise.resolve(true),
        requestCollabSync: async () => ({ status: "synced" }),
        requestInitialSeed: async () => seedState(seededBody),
        initialAppliedUpdatedAt: null,
        overlapPolicy: "prefer-live",
        editable: true,
      });
      return React.createElement("div");
    }
    act(() => root.render(React.createElement(Opener)));
    return {
      awareness,
      discover,
      markdown: () => getEditorMarkdown(editor!),
      dispose: () => {
        act(() => root.unmount());
        root = createRoot(container);
        awareness.destroy();
        ydoc.destroy();
      },
    };
  }

  it("seeds without waiting to learn who else is open", async () => {
    vi.useFakeTimers();
    const opener = mountOpener(AGENT_EDIT.value);
    try {
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(opener.markdown()).toBe(AGENT_EDIT.value);
      expect(opener.discover).not.toHaveBeenCalled();
      expect(heldRevision(opener.awareness)).toBe(AGENT_EDIT.revision);
    } finally {
      opener.dispose();
    }
  });

  it("reports no revision when another client's seed won with a different body", async () => {
    vi.useFakeTimers();
    const opener = mountOpener(ORIGINAL);
    try {
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(opener.markdown()).toBe(ORIGINAL);
      expect(heldRevision(opener.awareness)).toBeUndefined();
    } finally {
      opener.dispose();
    }
  });
});
