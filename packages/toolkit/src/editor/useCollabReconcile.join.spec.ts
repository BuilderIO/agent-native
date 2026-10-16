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

interface Snapshot {
  value: string;
  revision: string;
  updatedAt: string;
}

const STORED: Snapshot = {
  value: ORIGINAL,
  revision: "revision-0",
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const ACKNOWLEDGED: Snapshot = {
  value: SAVED,
  revision: "revision-1",
  updatedAt: "2024-01-01T00:00:05.000Z",
};
const AGENT_EDIT: Snapshot = {
  value: `${ORIGINAL}\n\nCharlie paragraph.`,
  revision: "revision-2",
  updatedAt: "2024-01-01T00:00:09.000Z",
};

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

/**
 * Three tabs on one live doc. A types and its save is held, so the stored body
 * lacks A's word; B was already open; C opens mid-save. A runs no reconcile
 * hook: it only types, as a tab whose save is in flight does, and its
 * awareness reports the revision it loaded.
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
  const tab = (name: string, reconciledRevision?: string): PeerState => ({
    user: { name },
    visible: true,
    canFlushDocument: true,
    ...(reconciledRevision ? { reconciledRevision } : {}),
  });
  awareness.B.getStates().set(ids.A, tab("A", STORED.revision));
  awareness.B.getStates().set(ids.C, tab("C"));

  let settleDiscovery: ((status: DiscoveryStatus) => void) | null = null;
  const discover = {
    B: async () => ({ status: "ready" as const }),
    C: () =>
      new Promise<{ status: DiscoveryStatus }>((resolve) => {
        settleDiscovery = (status) => resolve({ status });
      }),
  };

  const editors: { B: Editor | null; C: Editor | null } = { B: null, C: null };
  function Tab({ name, snapshot }: { name: "B" | "C"; snapshot: Snapshot }) {
    const editor = useEditor({
      extensions: createRichMarkdownExtensions({
        dialect: "gfm",
        ydoc: docs[name],
      }),
    });
    editors[name] = editor;
    useCollabReconcile({
      editor,
      ydoc: docs[name],
      awareness: awareness[name],
      collabSynced: true,
      value: snapshot.value,
      contentRevision: snapshot.revision,
      contentUpdatedAt: snapshot.updatedAt,
      discoverCollabPeers: joinsOnPeers ? discover[name] : undefined,
      initialAppliedUpdatedAt: null,
      overlapPolicy: "prefer-live",
      onBaseAwareReconcile: () => {},
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
    typeAsA: () => author.commands.insertContentAt(17, ` ${WORD}`),
    /** C's first sync: it fetches the live doc, then joins the relay. */
    syncC: () => {
      Y.applyUpdate(docs.C, Y.encodeStateAsUpdate(docs.A), "relay");
      connected.add(docs.C);
    },
    /**
     * C's presence request answers, after its first snapshot. By default it
     * learns A's and B's awareness as they stand.
     */
    discoverPeers: (
      status: DiscoveryStatus = "ready",
      peers: Array<[number, PeerState]> = [
        [ids.A, tab("A", STORED.revision)],
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
    markdown: (name: "A" | "C") =>
      name === "A" ? getEditorMarkdown(author) : getEditorMarkdown(editors.C!),
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
  snapshotC: Snapshot = STORED,
): Promise<void> {
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, { snapshot: STORED, withC: false }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  act(() => tabs.typeAsA());
  expect(tabs.counts()).toEqual({ A: 1, B: 1, C: null });

  tabs.syncC();
  act(() =>
    root.render(
      React.createElement(tabs.Tabs, {
        snapshot: STORED,
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

  it("applies a stored body newer than any collaborator holds", async () => {
    const tabs = makeTabs({ ids: { A: 5, B: 6, C: 3 } });
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs, AGENT_EDIT);
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(occurrences(tabs.markdown("C"), "Charlie paragraph.")).toBe(1);
      expect(occurrences(tabs.markdown("A"), "Charlie paragraph.")).toBe(1);
      expect(heldRevision(tabs.awareness.C)).toBe(AGENT_EDIT.revision);
    } finally {
      tabs.dispose();
    }
  });

  it("applies the stored body when it cannot learn who else is open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tabs = makeTabs();
    vi.useFakeTimers();
    try {
      await openCWhileASaves(tabs);
      await act(async () => tabs.discoverPeers("failed"));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 0, B: 0, C: 0 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not learn who else holds this document"),
      );
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
              user: { name: "Viewer" },
              visible: true,
              canFlushDocument: false,
              reconciledRevision: STORED.revision,
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
      await act(async () => tabs.discoverPeers());
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(tabs.counts()).toEqual({ A: 0, B: 0, C: 0 });
      expect(heldRevision(tabs.awareness.B)).toBeUndefined();
      expect(heldRevision(tabs.awareness.C)).toBeUndefined();
    } finally {
      tabs.dispose();
    }
  });

  it("seeds an empty live doc without waiting to learn who else is open", async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
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
        value: STORED.value,
        contentRevision: STORED.revision,
        contentUpdatedAt: STORED.updatedAt,
        discoverCollabPeers: () => new Promise(() => {}),
        initialAppliedUpdatedAt: null,
        overlapPolicy: "prefer-live",
        editable: true,
      });
      return React.createElement("div");
    }
    vi.useFakeTimers();
    try {
      act(() => root.render(React.createElement(Opener)));
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(getEditorMarkdown(editor!)).toBe(ORIGINAL);
      expect(heldRevision(awareness)).toBe(STORED.revision);
    } finally {
      act(() => root.unmount());
      root = createRoot(container);
      awareness.destroy();
      ydoc.destroy();
    }
  });
});
