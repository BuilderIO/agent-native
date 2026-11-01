import { createContentEditorStructuralSchema } from "@shared/content-editor-structural-schema";
import { LIVE_BODY_FIELD } from "@shared/live-body";
import { docToNfm } from "@shared/nfm";
import type { Schema } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { applyUpdate, Doc as YDoc } from "yjs";

import {
  holdPageDraftWriter,
  writePageDraftJournal,
  type PageDraftJournalScope,
  type PageDraftJournalSnapshot,
} from "./page-draft-journal";

// A page opened from its saved copy takes typing before the server answers.
// When the server's answer leaves some of it out (the doc was rebuilt, or the
// block it went into was deleted), the collab client hands it here. The
// server's doc stays as it is; the typing goes to History.

let structuralSchema: Schema | undefined;

/** The page body as it stood with the typing, or null when it held none. */
export function displacedTypingMarkdown(state: Uint8Array): string | null {
  const ydoc = new YDoc();
  try {
    applyUpdate(ydoc, state);
    const fragment = ydoc.getXmlFragment(LIVE_BODY_FIELD);
    if (fragment.length === 0) return null;
    structuralSchema ??= createContentEditorStructuralSchema();
    // Unlike the server's body, a node the schema drops is no reason to keep
    // nothing: what the schema can show is what the editor showed.
    const root = yXmlFragmentToProseMirrorRootNode(fragment, structuralSchema);
    return docToNfm(root.toJSON());
  } finally {
    ydoc.destroy();
  }
}

export interface JournaledDisplacedTyping {
  scope: PageDraftJournalScope;
  snapshot: PageDraftJournalSnapshot;
  /** Lets the next open, here or in another tab, file it in History. */
  release: () => void;
}

/**
 * Keeps displaced typing in the page's draft journal under a writer of its
 * own, held as live until `release` so no other tab files it meanwhile. An
 * entry left behind is filed in History on the next open.
 */
export function journalDisplacedTyping(input: {
  scope: Omit<PageDraftJournalScope, "writerId">;
  editorSessionId: string;
  title: string;
  content: string;
}): JournaledDisplacedTyping {
  const scope = {
    ...input.scope,
    writerId: `${input.editorSessionId}:displaced:${crypto.randomUUID()}`,
  };
  const release = holdPageDraftWriter(scope.writerId);
  // No base a page can be saved against: recovery files the entry in History
  // and never saves it over the page, where it would bring back what the
  // server deleted. A page that already holds it just drops it.
  const snapshot: PageDraftJournalSnapshot = {
    title: input.title,
    content: input.content,
    baseTitle: input.title,
    baseContent: input.content,
    baseUpdatedAt: null,
    editGeneration: 0,
  };
  try {
    writePageDraftJournal({ scope, snapshot });
  } catch (error) {
    release();
    throw error;
  }
  return { scope, snapshot, release };
}
