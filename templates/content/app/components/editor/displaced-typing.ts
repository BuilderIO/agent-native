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

export interface DisplacedTypingDraft {
  version: number;
  title: string;
  content: string;
}

const FILING_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/**
 * Files displaced typing in History the way a draft found on open is filed:
 * held as the editor's recovery draft, then resolved keeping the saved page.
 * The page has one draft slot per account. Each try runs as one job on the
 * editor's draft queue (`exclusive`), so the editor's own draft cannot take
 * the slot between the hold and the resolve. While its draft already holds
 * the slot, this waits and tries again; the journal entry covers the time in
 * between.
 */
export async function fileDisplacedTypingInHistory(input: {
  content: string;
  slot: {
    current: () => DisplacedTypingDraft | null;
    retain: () => Promise<void>;
    clear: (version: number) => void;
  };
  resolve: (
    draft: DisplacedTypingDraft,
    expectedDocumentUpdatedAt: string,
  ) => Promise<{
    status: string;
    document?: { updatedAt?: string | null } | null;
  }>;
  documentUpdatedAt: () => string | null;
  exclusive?: <T>(job: () => Promise<T>) => Promise<T>;
  retryDelaysMs?: readonly number[];
  wait?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const {
    content,
    slot,
    exclusive = (job) => job(),
    retryDelaysMs = FILING_RETRY_DELAYS_MS,
    wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = input;
  const fileOnce = async () => {
    let draft = slot.current();
    if (draft && draft.content !== content) return false;
    if (!draft) {
      await slot.retain();
      draft = slot.current();
      if (draft?.content !== content) return false;
    }
    let expectedDocumentUpdatedAt = input.documentUpdatedAt();
    for (let attempt = 0; attempt < 2 && expectedDocumentUpdatedAt; attempt++) {
      const result = await input.resolve(draft, expectedDocumentUpdatedAt);
      if (result.status === "resolved") {
        slot.clear(draft.version);
        return true;
      }
      expectedDocumentUpdatedAt = result.document?.updatedAt ?? null;
    }
    return false;
  };
  for (const delay of retryDelaysMs) {
    try {
      if (await exclusive(fileOnce)) return true;
    } catch {
      // coercion-ok: a failed try is tried again after the delay; the last
      // try's failure reaches the caller.
    }
    await wait(delay);
  }
  return exclusive(fileOnce);
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
