// @vitest-environment happy-dom

import { Editor as CoreEditor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { useEditor, type Editor } from "@tiptap/react";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
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

interface Acknowledgement extends Snapshot {
  sequence: number;
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

/** Refuses every edit but the live doc's, as a locked block refuses removal. */
const REFUSES_STORED_BODY = Extension.create({
  name: "refusesStoredBody",
  addProseMirrorPlugins: () => [
    new Plugin({
      filterTransaction: (transaction) =>
        !transaction.docChanged ||
        transaction.getMeta(ySyncPluginKey) !== undefined,
    }),
  ],
});

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
  cRefusesStoredBody = false,
  compare = compareRevisions,
}: {
  joinsOnPeers?: boolean;
  /** D, when it opens, defaults to the lowest id. */
  ids?: { A: number; B: number; C: number; D?: number };
  cRefusesStoredBody?: boolean;
  /** How the tabs order revisions; null passes no comparator. */
  compare?: ((first: string, second: string) => number | null) | null;
} = {}) {
  const docs = {
    A: new Y.Doc(),
    B: new Y.Doc(),
    C: new Y.Doc(),
    D: new Y.Doc(),
  };
  docs.A.clientID = ids.A;
  docs.B.clientID = ids.B;
  docs.C.clientID = ids.C;
  docs.D.clientID = ids.D ?? 0;
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

  const awareness = {
    B: new Awareness(docs.B),
    C: new Awareness(docs.C),
    D: new Awareness(docs.D),
  };
  awareness.B.setLocalState(peer("B"));
  awareness.C.setLocalState(peer("C"));
  awareness.D.setLocalState(peer("D"));
  awareness.B.getStates().set(ids.A, peer("A"));

  // B's updates reach the server unless its delivery is held.
  let deliveryHeld = false;
  const flush = {
    B: () =>
      deliveryHeld ? new Promise<boolean>(() => {}) : Promise.resolve(true),
    C: () => Promise.resolve(true),
    D: () => Promise.resolve(true),
  };
  /** C's first sync: it fetches the live doc, then joins the relay. */
  const syncC = () => {
    Y.applyUpdate(docs.C, Y.encodeStateAsUpdate(docs.A), "relay");
    connected.add(docs.C);
  };
  let catchUpStatus: "synced" | "failed" = "synced";
  let holdNextCatchUp = false;
  let releaseCatchUp: (() => void) | null = null;
  /** D's first sync, as C's. */
  const syncD = () => {
    Y.applyUpdate(docs.D, Y.encodeStateAsUpdate(docs.A), "relay");
    connected.add(docs.D);
  };
  const catchUp = {
    B: vi.fn(async () => ({ status: "synced" as const })),
    D: vi.fn(async () => ({ status: "synced" as const })),
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
  const remoteReports = { B: vi.fn(), C: vi.fn(), D: vi.fn() };
  const saves = { B: vi.fn(), C: vi.fn(), D: vi.fn() };
  let settleDiscovery: ((status: DiscoveryStatus) => void) | null = null;
  // Presence answers C could not read, as its connection counts them.
  let refusedPresence = 0;
  const discover = {
    B: async () => ({ status: "ready" as const }),
    C: vi.fn(() => {
      const refusedWhenSent = refusedPresence;
      return new Promise<{ status: DiscoveryStatus; current: () => boolean }>(
        (resolve) => {
          settleDiscovery = (status) =>
            resolve({
              status,
              current: () => refusedPresence === refusedWhenSent,
            });
        },
      );
    }),
    // D learns C as C's awareness stands when D asks.
    D: async () => {
      awareness.D.getStates().set(ids.C, awareness.C.getLocalState()!);
      awareness.D.emit("change", [
        { added: [ids.C], updated: [], removed: [] },
        "remote",
      ]);
      return { status: "ready" as const };
    },
  };

  type Name = "B" | "C" | "D";
  const editors: Record<Name, Editor | null> = { B: null, C: null, D: null };
  const results: Record<Name, ReturnType<typeof useCollabReconcile> | null> = {
    B: null,
    C: null,
    D: null,
  };
  function Tab({
    name,
    snapshot,
    joins = joinsOnPeers,
    acknowledged = null,
    collabRevision,
  }: {
    name: Name;
    snapshot: Snapshot;
    joins?: boolean;
    acknowledged?: Acknowledgement | null;
    /** The snapshot is one the live doc already holds. */
    collabRevision?: string;
  }) {
    // Wired as Content's editor wires them.
    const editor = useEditor({
      extensions: [
        ...createRichMarkdownExtensions({ dialect: "gfm", ydoc: docs[name] }),
        ...(name === "C" && cRefusesStoredBody ? [REFUSES_STORED_BODY] : []),
      ],
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
      collabContentRevision: collabRevision,
      value: snapshot.value,
      contentRevision: snapshot.revision,
      contentUpdatedAt: snapshot.updatedAt,
      compareContentRevisions: compare ?? undefined,
      acknowledgedLocalSnapshot: acknowledged,
      ...(joins
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
    joinsC,
    acknowledgedC,
    collabRevisionC,
    snapshotD,
  }: {
    snapshot: Snapshot;
    snapshotC?: Snapshot;
    withC: boolean;
    joinsC?: boolean;
    acknowledgedC?: Acknowledgement;
    collabRevisionC?: string;
    /** D opens on this snapshot. */
    snapshotD?: Snapshot;
  }) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Tab, { name: "B", snapshot }),
      withC
        ? React.createElement(Tab, {
            name: "C",
            snapshot: snapshotC,
            joins: joinsC,
            acknowledged: acknowledgedC,
            collabRevision: collabRevisionC,
          })
        : null,
      snapshotD
        ? React.createElement(Tab, { name: "D", snapshot: snapshotD })
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
    /**
     * A presence list reaches C that leaves the collaborator out, as an older
     * answer or an event from a server that does not know it does.
     */
    omitFromC: (clientId: number) => {
      awareness.C.getStates().delete(clientId);
      awareness.C.emit("change", [
        { added: [], updated: [], removed: [clientId] },
        "remote",
      ]);
    },
    /** A presence answer reaches C that it cannot read. */
    refusePresenceToC: () => {
      refusedPresence += 1;
    },
    joinFailed: (name: Name) => results[name]?.joinEvidenceFailed,
    retryJoin: (name: Name) => results[name]?.retryJoinEvidence(),
    syncC,
    syncD,
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
    markdown: (name: "A" | Name) =>
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
      awareness.D.destroy();
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
    settleMs = 200,
  }: { snapshotB?: Snapshot; snapshotC?: Snapshot; settleMs?: number } = {},
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
  await act(async () => vi.advanceTimersByTimeAsync(settleMs));
}

/** B holds the stored body; C opens with an agent edit only SQL has. */
async function openCOnAgentEdit(tabs: Tabs): Promise<void> {
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, { snapshot: STORED, withC: false }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  tabs.syncC();
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, {
        snapshot: STORED,
        snapshotC: AGENT_EDIT,
        withC: true,
      }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => tabs.discoverPeers());
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

  it("keeps the doc when a presence list that leaves out the collaborator holding it arrives while it catches up", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    tabs.holdCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      expect(heldRevision(tabs.awareness.B)).toBe(STORED.revision);
      await act(async () => tabs.discoverPeers());
      act(() => tabs.omitFromC(6));
      await act(async () => tabs.releaseCatchUp());
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("asks again when a presence answer it cannot read arrives after it learned who else is open", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    tabs.holdCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      // C learns of A alone; the answer that would name B is unreadable.
      await act(async () => tabs.discoverPeers("ready", [[5, peer("A")]]));
      act(() => tabs.refusePresenceToC());
      await act(async () => tabs.releaseCatchUp());
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(tabs.discover.C).toHaveBeenCalledTimes(2);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });

      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.joinFailed("C")).toBe(false);
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("asks again, rather than lead, when a presence answer it cannot read arrives while it waits to lead", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      // C learns of A alone, which holds no revision, and waits to lead.
      await act(async () => tabs.discoverPeers("ready", [[5, peer("A")]]));
      act(() => tabs.refusePresenceToC());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.discover.C).toHaveBeenCalledTimes(2);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });

      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.joinFailed("C")).toBe(false);
    } finally {
      tabs.dispose();
    }
  });

  it("counts a report that becomes one it can trust while it catches up", async () => {
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    tabs.holdCatchUp();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      // B's report reaches C before B can flush its updates, so it vouches for
      // nothing yet; B can flush by the time C's catch-up answers.
      await act(async () =>
        tabs.discoverPeers("ready", [
          [2, peer("A")],
          [3, { ...peer("B", STORED.revision), canFlushDocument: false }],
        ]),
      );
      act(() => tabs.reportToC(3, peer("B", STORED.revision)));
      await act(async () => tabs.releaseCatchUp());
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(tabs.catchUp.C).toHaveBeenCalledTimes(2);
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

  it("neither edits nor saves between its seed and its first reconcile", async () => {
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      // The seed's timer has fired; the first reconcile runs 25 ms later.
      await openCWhileASaves(tabs, { settleMs: 1 });
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(
        tabs.results.C!.shouldIgnoreUpdate(
          tabs.editors
            .C!.state.tr.insertText("typed ", 1)
            .setMeta("uiEvent", "input"),
        ),
      ).toBe(true);
      act(() =>
        tabs.editAsA((author) => author.commands.insertContentAt(1, "remote ")),
      );
      expect(tabs.remoteReports.C).not.toHaveBeenCalled();
      expect(tabs.saves.C).not.toHaveBeenCalled();
      expect(tabs.results.C!.isJoinPending()).toBe(true);
    } finally {
      tabs.dispose();
    }
  });

  it("holds from its seed when it opts in before the seed runs", async () => {
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: STORED, withC: false }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      act(() => tabs.typeAsA());
      tabs.syncC();
      for (const joinsC of [false, true])
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              withC: true,
              joinsC,
            }),
          ),
        );
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(tabs.results.C!.isJoinPending()).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);

      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
    } finally {
      tabs.dispose();
    }
  });

  it("neither edits nor saves until it applies a stored body no collaborator holds", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCOnAgentEdit(tabs);
      // The lead applies once its collaborators settle.
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(tabs.markdown("C")).toBe(ORIGINAL);
      expect(tabs.results.C!.isJoinPending()).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(
        tabs.results.C!.shouldIgnoreUpdate(
          tabs.editors
            .C!.state.tr.insertText("typed ", 1)
            .setMeta("uiEvent", "input"),
        ),
      ).toBe(true);

      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(occurrences(tabs.markdown("C"), CHARLIE)).toBe(1);
      expect(tabs.results.C!.isJoinPending()).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
    } finally {
      tabs.dispose();
    }
  });

  it("waits for the lead to apply a stored body no collaborator holds", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCOnAgentEdit(tabs);
      // Past the time it gives the lead, it still does not apply as one.
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.markdown("C")).toBe(ORIGINAL);
      expect(tabs.results.C!.isJoinPending()).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.joinFailed("C")).toBe(false);

      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: AGENT_EDIT, withC: true }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(occurrences(tabs.markdown("C"), CHARLIE)).toBe(1);
      expect(tabs.results.C!.isJoinPending()).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
    } finally {
      tabs.dispose();
    }
  });

  it("reports a stored body no collaborator holds that never reaches the doc", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCOnAgentEdit(tabs);
      await act(async () => vi.advanceTimersByTimeAsync(21_000));
      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.markdown("C")).toBe(ORIGINAL);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("The stored body did not reach this document"),
        expect.any(Error),
      );

      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: AGENT_EDIT, withC: true }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(occurrences(tabs.markdown("C"), CHARLIE)).toBe(1);
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
    } finally {
      tabs.dispose();
    }
  });

  it("reports a stored body that never reaches the doc though it keeps asking who else is open", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCOnAgentEdit(tabs);
      // What C learned goes stale every 2 s, and each time it learns again
      // that nobody holds the stored edit.
      for (let elapsed = 0; elapsed < 30_000; elapsed += 2_000) {
        await act(async () => vi.advanceTimersByTimeAsync(2_000));
        act(() => {
          tabs.refusePresenceToC();
          tabs.reportToC(2, peer("B", STORED.revision));
        });
        await act(async () => tabs.discoverPeers());
      }

      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.markdown("C")).toBe(ORIGINAL);
    } finally {
      tabs.dispose();
    }
  });

  it("reports a stored body that never reaches the doc by its first deadline, though asking again gets no answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCOnAgentEdit(tabs);
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      // What C learned goes stale, and its presence request to learn again
      // is never answered.
      act(() => {
        tabs.refusePresenceToC();
        tabs.reportToC(2, peer("B", STORED.revision));
      });
      await act(async () => vi.advanceTimersByTimeAsync(18_500));

      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(tabs.markdown("C")).toBe(ORIGINAL);
    } finally {
      tabs.dispose();
    }
  });

  it("lets go of an editor that outlives it", async () => {
    const doc = new Y.Doc();
    const author = new CoreEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: doc }),
    });
    author.commands.setContent(SAVED);
    author.destroy();
    const awareness = new Awareness(doc);
    awareness.setLocalState(peer("C"));
    const editor = new CoreEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc: doc }),
    }) as Editor;
    function Host() {
      useCollabReconcile({
        editor,
        ydoc: doc,
        awareness,
        collabSynced: true,
        value: STORED.value,
        contentRevision: STORED.revision,
        contentUpdatedAt: STORED.updatedAt,
        compareContentRevisions: compareRevisions,
        discoverCollabPeers: () => new Promise(() => {}),
        flushCollabUpdates: async () => true,
        requestCollabSync: async () => ({ status: "synced" as const }),
        initialAppliedUpdatedAt: null,
        editable: true,
      });
      return null;
    }
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(Host)));
      await act(async () => vi.advanceTimersByTimeAsync(200));
      expect(editor.isEditable).toBe(false);
      act(() => root.render(null));
      expect(editor.isEditable).toBe(true);
    } finally {
      editor.destroy();
      awareness.destroy();
      doc.destroy();
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

  it("takes the stored body as its base the moment a failed join's doc matches it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({ ids: { A: 2, B: 3, C: 1 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(true);

      // A deletes its word and types it again before C reconciles.
      act(() => {
        tabs.editAsA((author) =>
          author.commands.deleteRange({ from: 17, to: 18 + WORD.length }),
        );
        tabs.editAsA((author) =>
          author.commands.command(({ tr }) => {
            tr.insertText(` ${WORD}`, 17);
            return true;
          }),
        );
      });
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.joinFailed("C")).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
      expect(heldRevision(tabs.awareness.C)).toBe(STORED.revision);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
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

describe("useCollabReconcile: what finishes a join", () => {
  // A's word in the live doc and an older snapshot that holds it, as a stale
  // response or one reordered behind the agent edit delivers it.
  it.each([
    ["at the same time", { ...ACKNOWLEDGED, updatedAt: AGENT_EDIT.updatedAt }],
    ["from earlier", ACKNOWLEDGED],
  ])(
    "does not finish on an older snapshot %s that matches the doc",
    async (_, older) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
        await act(async () => tabs.discoverPeers());
        expect(tabs.results.C!.isJoinPending()).toBe(true);

        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: older,
              withC: true,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));

        expect(tabs.markdown("C")).toBe(older.value);
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        expect(tabs.editors.C!.isEditable).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBeUndefined();
      } finally {
        tabs.dispose();
      }
    },
  );

  // The first request is kept when a newer snapshot arrives, so its revision
  // can still match an older snapshot that arrives after it.
  it.each([
    ["at the same time", { ...STORED, updatedAt: AGENT_EDIT.updatedAt }],
    ["from earlier", STORED],
  ])(
    "does not finish on an older snapshot %s while its first request waits",
    async (_, older) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs, { snapshotC: older });
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: AGENT_EDIT,
              withC: true,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.discover.C).toHaveBeenCalledTimes(1);

        // A takes its word back, so the doc holds the older body again.
        act(() =>
          tabs.editAsA((author) => author.commands.setContent(ORIGINAL)),
        );
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: older,
              withC: true,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));

        expect(tabs.markdown("C")).toBe(ORIGINAL);
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        expect(tabs.editors.C!.isEditable).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBeUndefined();
      } finally {
        tabs.dispose();
      }
    },
  );

  // A's save lands at the time of the snapshot C opened on, under a revision
  // nothing can order against it.
  it.each([
    ["one that cannot order them", () => null],
    ["absent", null],
  ])(
    "finishes on a same-time snapshot the doc matches when the comparator is %s",
    async (_, compare) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 }, compare });
      const opened: Snapshot = { ...STORED, revision: "opaque:first" };
      const saved: Snapshot = {
        value: SAVED,
        revision: "opaque:second",
        updatedAt: opened.updatedAt,
      };
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs, { snapshotC: opened });
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: saved,
              withC: true,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));

        expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(tabs.editors.C!.isEditable).toBe(true);
        expect(heldRevision(tabs.awareness.C)).toBe(saved.revision);
      } finally {
        tabs.dispose();
      }
    },
  );

  // A stale response brings back the snapshot C opened on after C took a
  // same-time one over it, under revisions nothing can order.
  it.each([
    ["one that cannot order them", () => null],
    ["absent", null],
  ])(
    "does not finish on a same-time snapshot it took another over when the comparator is %s",
    async (_, compare) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 }, compare });
      const opened: Snapshot = { ...STORED, revision: "opaque:first" };
      const taken: Snapshot = {
        ...AGENT_EDIT,
        revision: "opaque:second",
        updatedAt: opened.updatedAt,
      };
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs, { snapshotC: opened });
        for (const snapshotC of [taken, opened]) {
          // A takes its word back, so the doc holds the replayed body.
          if (snapshotC === opened)
            act(() =>
              tabs.editAsA((author) => author.commands.setContent(ORIGINAL)),
            );
          act(() =>
            root.render(
              React.createElement(tabs.Tabs, {
                snapshot: STORED,
                snapshotC,
                withC: true,
              }),
            ),
          );
          await act(async () => vi.advanceTimersByTimeAsync(100));
        }

        expect(tabs.markdown("C")).toBe(ORIGINAL);
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        expect(tabs.editors.C!.isEditable).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBeUndefined();
      } finally {
        tabs.dispose();
      }
    },
  );

  it("does not apply a same-time snapshot it took another over that a collaborator holds", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 }, compare: () => null });
    const opened: Snapshot = { ...STORED, revision: "opaque:first" };
    const taken: Snapshot = {
      ...AGENT_EDIT,
      revision: "opaque:second",
      updatedAt: opened.updatedAt,
    };
    const live = `${SAVED}\n\n${CHARLIE}`;
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: opened });
      act(() => tabs.editAsA((author) => author.commands.setContent(live)));
      for (const snapshotC of [taken, opened]) {
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC,
              withC: true,
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));
      }
      // C leads, and A reports holding the snapshot C took.
      await act(async () =>
        tabs.discoverPeers("ready", [[5, peer("A", taken.revision)]]),
      );
      await act(async () => vi.advanceTimersByTimeAsync(6_000));

      expect(tabs.markdown("C")).toBe(live);
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
      expect(tabs.results.C!.isJoinPending()).toBe(true);
      expect(heldRevision(tabs.awareness.C)).toBeUndefined();
      // No newer snapshot comes, so it reports the join it cannot finish.
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.markdown("C")).toBe(live);
    } finally {
      tabs.dispose();
    }
  });

  // C accepts the acknowledgement of a save that lands after the snapshot it
  // opened on, and then the doc moves to an older snapshot.
  const acknowledged: Acknowledgement = {
    ...AGENT_EDIT,
    value: SAVED,
    revision: "body:3:d",
    sequence: 1,
  };
  const between: Snapshot = {
    ...AGENT_EDIT,
    value: `${SAVED}\n\n${CHARLIE}`,
    updatedAt: "2024-01-01T00:00:07.000Z",
  };
  const takeWordBack = (author: CoreEditor) =>
    author.commands.setContent(ORIGINAL);
  it.each([
    [
      "that arrives after it",
      acknowledged,
      between,
      (author: CoreEditor) =>
        author.commands.insertContentAt(author.state.doc.content.size, {
          type: "paragraph",
          content: [{ type: "text", text: CHARLIE }],
        }),
    ],
    ["it already had", acknowledged, STORED, takeWordBack],
    [
      "at the same time, which it already had",
      { ...acknowledged, updatedAt: STORED.updatedAt },
      STORED,
      takeWordBack,
    ],
  ])(
    "does not finish on a snapshot older than a save it has had acknowledged %s",
    async (_, acknowledgedC, older, move) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs);
        for (const [snapshotC, moves] of [
          [STORED, false],
          [older, true],
        ] as const) {
          if (moves) act(() => tabs.editAsA(move));
          act(() =>
            root.render(
              React.createElement(tabs.Tabs, {
                snapshot: STORED,
                snapshotC,
                withC: true,
                acknowledgedC,
              }),
            ),
          );
          await act(async () => vi.advanceTimersByTimeAsync(100));
        }

        expect(tabs.markdown("C")).toBe(older.value);
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        expect(tabs.editors.C!.isEditable).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBe(acknowledgedC.revision);
      } finally {
        tabs.dispose();
      }
    },
  );

  it.each([
    ["with it", [ACKNOWLEDGED]],
    ["after it", [STORED, ACKNOWLEDGED]],
  ])(
    "finishes on a snapshot the doc matches that equals a save it has had acknowledged, arriving %s",
    async (_, snapshotsC) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs);
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        for (const snapshotC of snapshotsC) {
          act(() =>
            root.render(
              React.createElement(tabs.Tabs, {
                snapshot: STORED,
                snapshotC,
                withC: true,
                acknowledgedC: { ...ACKNOWLEDGED, sequence: 1 },
              }),
            ),
          );
          await act(async () => vi.advanceTimersByTimeAsync(100));
        }

        expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(tabs.editors.C!.isEditable).toBe(true);
        expect(heldRevision(tabs.awareness.C)).toBe(ACKNOWLEDGED.revision);
        await act(async () => vi.advanceTimersByTimeAsync(21_000));
        expect(tabs.joinFailed("C")).toBe(false);
      } finally {
        tabs.dispose();
      }
    },
  );

  // The page changes after A's save lands without its body changing, so C
  // sees A's saved body stored later than the acknowledgement of it.
  it.each<[string, ((first: string, second: string) => number | null) | null]>([
    ["orders the revisions", compareRevisions],
    ["cannot order the revisions", () => null],
    ["passes no comparator", null],
  ])(
    "finishes on a snapshot the doc matches stored after an older acknowledgement of the same body, when it %s",
    async (_, compare) => {
      const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 }, compare });
      const later: Snapshot = {
        ...ACKNOWLEDGED,
        updatedAt: "2024-01-01T00:00:07.000Z",
      };
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs);
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: later,
              withC: true,
              acknowledgedC: { ...ACKNOWLEDGED, sequence: 1 },
            }),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(21_000));

        expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(tabs.joinFailed("C")).toBe(false);
        expect(tabs.editors.C!.isEditable).toBe(true);
        expect(heldRevision(tabs.awareness.C)).toBe(ACKNOWLEDGED.revision);
      } finally {
        tabs.dispose();
      }
    },
  );

  // C opens on one body and takes a same-time newer one the live doc already
  // holds. The first comes back with its save acknowledged, which C refuses,
  // and then the doc moves to the newer body, which finishes C's join.
  it.each<[string, ((first: string, second: string) => number | null) | null]>([
    ["passes no comparator", null],
    ["cannot order the revisions", () => null],
  ])(
    "keeps refusing an acknowledgement it refused while joining, so a later tab's join keeps its text, when it %s",
    async (_, compare) => {
      const tabs = makeTabs({ compare });
      const newer: Snapshot = { ...AGENT_EDIT, updatedAt: STORED.updatedAt };
      const acknowledgedC: Acknowledgement = { ...STORED, sequence: 1 };
      const LOCAL = "zl0cal4C";
      const show = (
        props: Omit<Parameters<typeof tabs.Tabs>[0], "snapshot" | "withC">,
      ) =>
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              withC: true,
              ...props,
            }),
          ),
        );
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs);
        tabs.holdCatchUp();
        show({ snapshotC: newer, collabRevisionC: newer.revision });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        act(() =>
          tabs.editAsA((author) => author.commands.setContent(STORED.value)),
        );
        show({ snapshotC: STORED, acknowledgedC });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.results.C!.isJoinPending()).toBe(true);
        act(() =>
          tabs.editAsA((author) => author.commands.setContent(newer.value)),
        );
        show({ snapshotC: newer, acknowledgedC });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBe(newer.revision);

        act(() =>
          tabs.editors.C!.commands.insertContentAt(
            tabs.editors.C!.state.doc.content.size - 1,
            ` ${LOCAL}`,
          ),
        );
        // D opens on the newer body, leads, and asks who is open.
        tabs.syncD();
        show({ snapshotC: newer, acknowledgedC, snapshotD: newer });
        await act(async () => vi.advanceTimersByTimeAsync(6_000));

        expect(tabs.results.D!.isJoinPending()).toBe(false);
        expect(occurrences(tabs.markdown("D"), LOCAL)).toBe(1);
        expect(occurrences(tabs.markdown("C"), LOCAL)).toBe(1);
      } finally {
        tabs.dispose();
      }
    },
  );

  // C finishes its join on the newer body. Props for the older body come
  // late, dated between the two, after an unsaved edit returns C's text to
  // the older body's.
  it.each<[string, ((first: string, second: string) => number | null) | null]>([
    ["orders the revisions", compareRevisions],
    ["cannot order the revisions", () => null],
    ["passes no comparator", null],
  ])(
    "keeps reporting the body it joined on when older props arrive late, so a later tab's join keeps its text, when it %s",
    async (_, compare) => {
      const tabs = makeTabs({ compare });
      const acknowledgedC: Acknowledgement = { ...STORED, sequence: 4 };
      const late: Snapshot = {
        ...STORED,
        updatedAt: "2024-01-01T00:00:07.000Z",
      };
      const LOCAL = "zl0cal4C";
      const show = (
        props: Omit<Parameters<typeof tabs.Tabs>[0], "snapshot" | "withC">,
      ) =>
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              withC: true,
              ...props,
            }),
          ),
        );
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs);
        show({ snapshotC: AGENT_EDIT });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        show({ snapshotC: AGENT_EDIT, acknowledgedC });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        act(() =>
          tabs.editAsA((author) =>
            author.commands.setContent(AGENT_EDIT.value),
          ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);

        act(() => tabs.editors.C!.commands.setContent(STORED.value));
        await act(async () => vi.advanceTimersByTimeAsync(100));
        show({ snapshotC: late, acknowledgedC });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);

        act(() =>
          tabs.editors.C!.commands.insertContentAt(
            tabs.editors.C!.state.doc.content.size - 1,
            ` ${LOCAL}`,
          ),
        );
        // D opens on the newer body, leads, and asks who is open.
        tabs.syncD();
        show({ snapshotC: late, acknowledgedC, snapshotD: AGENT_EDIT });
        await act(async () => vi.advanceTimersByTimeAsync(6_000));

        expect(tabs.results.D!.isJoinPending()).toBe(false);
        expect(occurrences(tabs.markdown("D"), LOCAL)).toBe(1);
        expect(occurrences(tabs.markdown("C"), LOCAL)).toBe(1);
      } finally {
        tabs.dispose();
      }
    },
  );

  // C leads and no collaborator holds either stored body, so C applies one.
  it.each([
    [
      "an edit to text the doc changed too",
      STORED,
      "Alpha paragraph, rewritten by an agent.\n\nBravo paragraph.",
    ],
    [
      "an edit beside a stored edit the doc lacks",
      {
        ...STORED,
        value: "Alpha paragraph.\n\nBravo paragraph, edited by an agent.",
      },
      `Alpha paragraph.\n\nBravo paragraph, edited by an agent.\n\n${CHARLIE}`,
    ],
  ])(
    "takes a stored body that moves while it joins, with %s",
    async (_, opened, moved) => {
      const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
      const onlyA: Array<[number, PeerState]> = [[5, peer("A")]];
      const later: Snapshot = { ...AGENT_EDIT, value: moved };
      vi.useFakeTimers();
      try {
        await openCWhileASaves(tabs, { snapshotC: opened });
        act(() =>
          root.render(
            React.createElement(tabs.Tabs, {
              snapshot: STORED,
              snapshotC: later,
              withC: true,
            }),
          ),
        );
        await act(async () => tabs.discoverPeers("ready", onlyA));
        await act(async () => vi.advanceTimersByTimeAsync(100));
        await act(async () => tabs.discoverPeers("ready", onlyA));
        await act(async () => vi.advanceTimersByTimeAsync(6_000));

        // Merged against the body it opened on, which the doc never held, it
        // kept the doc's text over the stored edit and reported holding it.
        expect(tabs.markdown("C")).toBe(moved);
        expect(tabs.results.C!.isJoinPending()).toBe(false);
        expect(heldRevision(tabs.awareness.C)).toBe(later.revision);
      } finally {
        tabs.dispose();
      }
    },
  );

  it("reports a stored body its editor refuses, and neither edits nor saves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs({
      ids: { A: 5, B: 6, C: 3 },
      cRefusesStoredBody: true,
    });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));

      expect(tabs.markdown("C")).toBe(SAVED);
      expect(tabs.joinFailed("C")).toBe(true);
      expect(tabs.editors.C!.isEditable).toBe(false);
      expect(heldRevision(tabs.awareness.C)).toBeUndefined();
      expect(tabs.saves.C).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("The editor refused the stored body"),
        expect.any(Error),
      );
    } finally {
      tabs.dispose();
    }
  });

  it("finishes once the lead reports merging the stored body into a doc with unsaved text", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 2, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.results.C!.isJoinPending()).toBe(true);

      // B leads and merges the agent edit beside A's unsaved word, so C's doc
      // holds the stored body but never equals it.
      act(() =>
        root.render(
          React.createElement(tabs.Tabs, { snapshot: AGENT_EDIT, withC: true }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.markdown("C")).toBe(`${SAVED}\n\n${CHARLIE}`);
      expect(heldRevision(tabs.awareness.B)).toBe(AGENT_EDIT.revision);

      const discoveries = tabs.discover.C.mock.calls.length;
      act(() =>
        tabs.reportToC(2, tabs.awareness.B.getLocalState() as PeerState),
      );
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(1_000));

      expect(tabs.discover.C).toHaveBeenCalledTimes(discoveries + 1);
      expect(tabs.results.C!.isJoinPending()).toBe(false);
      expect(tabs.editors.C!.isEditable).toBe(true);
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
      await act(async () => vi.advanceTimersByTimeAsync(21_000));
      expect(tabs.joinFailed("C")).toBe(false);
    } finally {
      tabs.dispose();
    }
  });

  // After C learns that no collaborator holds the agent edit, A merges it
  // beside its unsaved word and reports holding it.
  function mergeAsA(tabs: Tabs, visible = true) {
    tabs.editAsA((author) =>
      author.commands.insertContentAt(author.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: CHARLIE }],
      }),
    );
    tabs.reportToC(5, { ...peer("A", AGENT_EDIT.revision), visible });
  }

  it("keeps the doc a collaborator reports holding before C listens for reports", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      const catchUps = tabs.catchUp.C.mock.calls.length;
      // C's catch-up settles, and A's report lands before React commits.
      await act(async () => {
        tabs.discoverPeers();
        for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
        expect(tabs.catchUp.C.mock.calls.length).toBeGreaterThan(catchUps);
        for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
        mergeAsA(tabs);
      });
      // Nothing else changes, so nothing else would make C look again.
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });

      await act(async () =>
        tabs.discoverPeers("ready", [[5, peer("A", AGENT_EDIT.revision)]]),
      );
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(tabs.markdown("C")).toBe(`${SAVED}\n\n${CHARLIE}`);
      expect(tabs.results.C!.isJoinPending()).toBe(false);
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("keeps the doc a collaborator reports holding just before C applies the stored body", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    // A's tab is in the background, so C applies without waiting for its
    // collaborators to settle.
    const hiddenA = (revision?: string): Array<[number, PeerState]> => [
      [5, { ...peer("A", revision), visible: false }],
    ];
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, { snapshotC: AGENT_EDIT });
      await act(async () => tabs.discoverPeers("ready", hiddenA()));
      // C has scheduled its apply. A's report lands and the apply runs before
      // React cleans it up.
      await act(async () => {
        for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
        mergeAsA(tabs, false);
        vi.advanceTimersByTime(0);
      });
      expect(tabs.counts()).toEqual({ A: 1, B: 1, C: 1 });

      await act(async () =>
        tabs.discoverPeers("ready", hiddenA(AGENT_EDIT.revision)),
      );
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(tabs.markdown("C")).toBe(`${SAVED}\n\n${CHARLIE}`);
      expect(tabs.results.C!.isJoinPending()).toBe(false);
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
    } finally {
      tabs.dispose();
    }
  });
});

describe("useCollabReconcile: seeding an empty live doc", () => {
  function mountOpener(
    seededBody: string,
    discovered: Promise<{ status: DiscoveryStatus }> = new Promise(() => {}),
  ) {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(peer("Opener"));
    const discover = vi.fn(() => discovered);
    const saves = vi.fn();
    let editor: Editor | null = null;
    let result: ReturnType<typeof useCollabReconcile> | null = null;
    function Opener() {
      editor = useEditor({
        extensions: createRichMarkdownExtensions({ dialect: "gfm", ydoc }),
        onUpdate: ({ editor: updated, transaction }) => {
          if (!result || result.shouldIgnoreUpdate(transaction)) return;
          saves(getEditorMarkdown(updated));
        },
      });
      result = useCollabReconcile({
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
      saves,
      editor: () => editor!,
      result: () => result!,
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

  it("joins, reporting no revision, when another client's seed won with a different body", async () => {
    vi.useFakeTimers();
    const opener = mountOpener(ORIGINAL);
    try {
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(opener.markdown()).toBe(ORIGINAL);
      expect(heldRevision(opener.awareness)).toBeUndefined();
      expect(opener.discover).toHaveBeenCalled();
      expect(opener.result().isJoinPending()).toBe(true);
      expect(opener.editor().isEditable).toBe(false);
      expect(opener.saves).not.toHaveBeenCalled();
    } finally {
      opener.dispose();
    }
  });

  it("applies its own body over another client's seed that no collaborator holds", async () => {
    vi.useFakeTimers();
    const opener = mountOpener(ORIGINAL, Promise.resolve({ status: "ready" }));
    try {
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(opener.markdown()).toBe(AGENT_EDIT.value);
      expect(opener.result().isJoinPending()).toBe(false);
      expect(opener.editor().isEditable).toBe(true);
      expect(heldRevision(opener.awareness)).toBe(AGENT_EDIT.revision);
    } finally {
      opener.dispose();
    }
  });
});
