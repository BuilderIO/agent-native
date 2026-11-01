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
  journalDisplacedTyping,
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
