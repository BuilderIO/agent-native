// @vitest-environment happy-dom

/**
 * A visited page opens from its saved copy and takes typing before the server
 * answers. Typing into a block the server has deleted since is handed to the
 * page, which keeps it in the draft journal; the server's deletion stands.
 * Runs the real collab client with the editor's schema and Yjs binding.
 */
import {
  useCollaborativeDoc,
  type DisplacedCollabEdits,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client/collab";
import { LIVE_BODY_FIELD } from "@shared/live-body";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import {
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  displacedTypingMarkdown,
  fileDisplacedTypingInHistory,
  journalDisplacedTyping,
  keepDisplacedTyping,
  type DisplacedTypingDraft,
} from "./displaced-typing";
import { readPageDraftJournal } from "./page-draft-journal";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());
const DOC = "displaced-typing-page";
const ADA = { name: "Ada", email: "ada@example.com", color: "#123456" };

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** The page body `fragment` shows, as the editor saves it. */
function bodyOf(fragment: Y.XmlFragment): string {
  return docToNfm(yXmlFragmentToProseMirrorRootNode(fragment, schema).toJSON());
}

let root: Root;
let container: HTMLDivElement;
let server: Y.Doc;
let holdState: Promise<void> | null;
let latest: UseCollaborativeDocResult | null;
let displaced: DisplacedCollabEdits[];

function Page() {
  latest = useCollaborativeDoc({
    docId: DOC,
    user: ADA,
    localCopy: { onEditsDisplaced: (edits) => displaced.push(edits) },
  });
  return null;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  displaced = [];
  holdState = null;
  latest = null;
  server = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    schema,
    schema
      .nodeFromJSON(nfmToDoc("First paragraph.\nSecond paragraph."))
      .toJSON(),
    server.getXmlFragment(LIVE_BODY_FIELD),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state/.test(url)) {
        if (holdState) await holdState;
        const vector = new URL(url, "http://test").searchParams.get(
          "stateVector",
        );
        return new Response(
          JSON.stringify({
            docId: DOC,
            state: toBase64(
              vector
                ? Y.encodeStateAsUpdate(server, fromBase64(vector))
                : Y.encodeStateAsUpdate(server),
            ),
            ...(vector
              ? { stateVector: toBase64(Y.encodeStateVector(server)) }
              : {}),
          }),
        );
      }
      if (/\/collab\/[^/]+\/update/.test(url)) {
        const { update } = JSON.parse(String(init?.body)) as {
          update: string;
        };
        Y.applyUpdate(server, fromBase64(update));
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  server.destroy();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps typing that went into a paragraph the server has deleted since, and keeps the deletion", async () => {
  // A first visit leaves the page's copy in this tab.
  act(() => root.render(<Page />));
  await advance(50);
  expect(latest?.isSynced).toBe(true);
  act(() => root.unmount());
  await advance(1_100);

  // Deleted on the server (an agent, another tab) while the page is closed.
  server.getXmlFragment(LIVE_BODY_FIELD).delete(0, 1);

  let release!: () => void;
  holdState = new Promise<void>((resolve) => (release = resolve));
  root = createRoot(container);
  act(() => root.render(<Page />));
  await advance(0);
  expect(latest?.fromLocalCopy).toBe(true);
  const ydoc = latest?.ydoc;
  if (!ydoc) throw new Error("The page has no doc");
  const fragment = ydoc.getXmlFragment(LIVE_BODY_FIELD);

  // Typed at the end of the first paragraph, as the editor's binding writes it.
  act(() => {
    const shown = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    const typed = EditorState.create({ doc: shown }).tr.insertText(
      " Typed on the copy",
      1 + shown.child(0).content.size,
    ).doc;
    updateYFragment(ydoc, fragment, typed, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  });
  expect(bodyOf(fragment)).toContain("First paragraph. Typed on the copy");
  holdState = null;
  release();
  await advance(200);

  // The server's deletion stands, on both sides.
  expect(bodyOf(fragment)).toBe("Second paragraph.");
  expect(bodyOf(server.getXmlFragment(LIVE_BODY_FIELD))).toBe(
    "Second paragraph.",
  );

  // The page gets the typing as it stood, and the journal keeps it.
  expect(displaced.map((edits) => edits.reason)).toEqual(["deleted"]);
  const content = "First paragraph. Typed on the copy\nSecond paragraph.";
  expect(
    displaced.map((edits) => displacedTypingMarkdown(edits.state)),
  ).toEqual([content]);
  const scope = { accountId: ADA.email, orgId: null, documentId: DOC };
  const journaled = journalDisplacedTyping({
    scope,
    editorSessionId: "tab:page:editor",
    title: "Page",
    content,
  });
  // Bound for History: no base the page could be saved against.
  expect(readPageDraftJournal(scope)).toMatchObject({
    scope: { writerId: journaled.scope.writerId },
    snapshot: { content, baseContent: content, baseUpdatedAt: null },
  });
  // Another editor's entries are not this one's.
  expect(journaled.scope.writerId).toMatch(/^tab:page:editor:displaced:/);
  journaled.release();
});

/** The page's one draft slot, as the editor's recovery draft ref holds it. */
function draftSlot() {
  let held: DisplacedTypingDraft | null = null;
  let version = 0;
  return {
    hold(content: string) {
      held = { version: ++version, title: "Page", content };
    },
    free() {
      held = null;
    },
    get held() {
      return held;
    },
  };
}

it("files displaced typing once the editor's own draft lets go of the page's draft slot", async () => {
  const page = draftSlot();
  page.hold("The editor's own draft");
  const resolve = vi.fn<
    (draft: DisplacedTypingDraft) => Promise<{ status: string }>
  >(async () => ({ status: "resolved" }));
  const filed = await fileDisplacedTypingInHistory({
    content: "Typed on the copy",
    slot: {
      current: () => page.held,
      retain: async () => page.hold("Typed on the copy"),
      clear: () => page.free(),
    },
    resolve,
    documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
    owned: () => true,
    // The editor settles its own draft meanwhile.
    wait: async () => page.free(),
  });

  expect(filed).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve.mock.calls[0]?.[0]).toMatchObject({
    content: "Typed on the copy",
  });
  expect(page.held).toBeNull();
});

it("tries again when the editor's own draft takes the slot back before the resolve lands", async () => {
  // As in a browser: the editor kept a draft of its own between the upsert
  // and the resolve, and the server answered that the draft had changed.
  const page = draftSlot();
  const resolve = vi
    .fn<(draft: DisplacedTypingDraft) => Promise<{ status: string }>>()
    .mockImplementationOnce(async () => {
      page.hold("The editor's own draft");
      throw new Error("The saved draft changed during recovery.");
    })
    .mockImplementation(async () => ({ status: "resolved" }));
  const filed = await fileDisplacedTypingInHistory({
    content: "Typed on the copy",
    slot: {
      current: () => page.held,
      retain: async () => page.hold("Typed on the copy"),
      clear: () => page.free(),
    },
    resolve,
    documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
    owned: () => true,
    wait: async () => page.free(),
  });

  expect(filed).toBe(true);
  expect(resolve.mock.calls.map(([draft]) => draft.content)).toEqual([
    "Typed on the copy",
    "Typed on the copy",
  ]);
});

it("keeps the editor's own draft out of the slot between holding the typing and resolving it", async () => {
  // As in a browser: the server's answer moves the editor, whose own save
  // keeps a draft while the typing's resolve is on its way.
  const page = draftSlot();
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(job: () => Promise<T>): Promise<T> => {
    const queued = queue.then(job, job);
    queue = queued.catch(() => undefined);
    return queued;
  };
  let editorDraft: Promise<unknown> | null = null;
  const resolve = vi.fn<
    (draft: DisplacedTypingDraft) => Promise<{ status: string }>
  >(async (draft) => {
    editorDraft ??= exclusive(async () => page.hold("Second paragraph."));
    await Promise.resolve();
    if (page.held?.version !== draft.version) {
      throw new Error("The saved draft changed during recovery.");
    }
    return { status: "resolved" };
  });
  const filed = await fileDisplacedTypingInHistory({
    content: "Typed on the copy",
    slot: {
      current: () => page.held,
      retain: async () => page.hold("Typed on the copy"),
      clear: () => page.free(),
    },
    resolve,
    documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
    owned: () => true,
    exclusive,
    // The editor's draft stays for the session.
    wait: async () => {},
  });
  await editorDraft;

  expect(filed).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
  // The editor's own draft goes in after, not lost.
  expect(page.held?.content).toBe("Second paragraph.");
});

it("leaves the typing to the journal when the slot never frees", async () => {
  const page = draftSlot();
  page.hold("The editor's own draft");
  const resolve = vi.fn<
    (draft: DisplacedTypingDraft) => Promise<{ status: string }>
  >(async () => ({ status: "resolved" }));
  const waits: number[] = [];
  const filed = await fileDisplacedTypingInHistory({
    content: "Typed on the copy",
    slot: {
      current: () => page.held,
      retain: async () => page.hold("Typed on the copy"),
      clear: () => page.free(),
    },
    resolve,
    documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
    owned: () => true,
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  expect(filed).toBe(false);
  expect(resolve).not.toHaveBeenCalled();
  // Bounded: about fifteen seconds, then the next open files it.
  expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
  expect(page.held?.content).toBe("The editor's own draft");
});

it("stops filing once the tab changes account and org, and leaves the typing in the journal", async () => {
  const scope = { accountId: ADA.email, orgId: "org-a", documentId: DOC };
  let session: { accountId: string; orgId: string | null } = {
    accountId: ADA.email,
    orgId: "org-a",
  };
  const page = draftSlot();
  // The first try fails, and meanwhile the tab signs in as Bob in his org.
  const retain = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(async () => {
      session = { accountId: "bob@example.com", orgId: "org-b" };
      throw new Error("Failed to fetch");
    })
    .mockImplementation(async () => page.hold("Typed on the copy"));
  const resolve = vi.fn<
    (draft: DisplacedTypingDraft) => Promise<{ status: string }>
  >(async () => ({ status: "resolved" }));

  const outcome = await keepDisplacedTyping({
    scope,
    editorSessionId: "tab:page:editor",
    title: "Page",
    content: "Typed on the copy",
    filing: {
      slot: {
        current: () => page.held,
        retain,
        clear: () => page.free(),
      },
      resolve,
      documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
      owned: () =>
        session.accountId === scope.accountId && session.orgId === scope.orgId,
      wait: async () => {},
    },
  });

  // Nothing is held or filed under Bob; Ada's next open files the entry.
  expect(outcome).toBe("journaled");
  expect(retain).toHaveBeenCalledTimes(1);
  expect(resolve).not.toHaveBeenCalled();
  expect(page.held).toBeNull();
  expect(readPageDraftJournal(scope)).toMatchObject({
    snapshot: { content: "Typed on the copy", baseUpdatedAt: null },
  });
});

it("stops filing when the editor closes, without waiting out its retries", async () => {
  const scope = { accountId: ADA.email, orgId: "org-closed", documentId: DOC };
  const page = draftSlot();
  page.hold("The editor's own draft");
  const retain = vi.fn(async () => page.hold("Typed on the copy"));
  const resolve = vi.fn<
    (draft: DisplacedTypingDraft) => Promise<{ status: string }>
  >(async () => ({ status: "resolved" }));
  const closed = new AbortController();

  const outcome = keepDisplacedTyping({
    scope,
    editorSessionId: "tab:page:editor",
    title: "Page",
    content: "Typed on the copy",
    filing: {
      slot: {
        current: () => page.held,
        retain,
        clear: () => page.free(),
      },
      resolve,
      documentUpdatedAt: () => "2026-11-01T05:00:00.000Z",
      owned: () => true,
      signal: closed.signal,
    },
  });
  await advance(0);
  // The editor closes while its own draft holds the slot.
  closed.abort();
  page.free();
  await advance(15_000);

  expect(await outcome).toBe("journaled");
  expect(retain).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(readPageDraftJournal(scope)).toMatchObject({
    snapshot: { content: "Typed on the copy" },
  });
});
