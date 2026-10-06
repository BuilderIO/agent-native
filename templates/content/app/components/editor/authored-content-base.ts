import { bodyHoldsChanges } from "@shared/document-intent-merge";

export interface AuthoredContentBase {
  revision?: string;
  content: string;
}

// Forgetting an older observation only keeps the base held, which keeps text.
const MAX_SEEN_WHILE_SAVING = 16;

/**
 * A save the server merged with another writer's text confirms a body this
 * editor does not hold until that text reaches it through collaboration or
 * the reconcile. An edit authored on that body reads the missing text as
 * deleted, so edits stay on the base the merged save was authored on until
 * the editor holds the saved body. Holding it any longer reads a deliberate
 * deletion of the other writer's text as an edit that never touched it.
 */
export function createAuthoredContentBase() {
  let unheld: { revision: string; base: AuthoredContentBase } | null = null;
  // The other writer's text can arrive and be deleted here before the save's
  // answer names the body that holds it.
  let seenWhileSaving: string[] = [];
  // The other writer's text can reach the editor before the save's answer,
  // or alongside typing here, so an exact match with the saved body misses
  // an editor that already holds it.
  const holds = (
    editorContent: string,
    saved: AuthoredContentBase,
    base: AuthoredContentBase,
  ) =>
    editorContent === saved.content ||
    bodyHoldsChanges(base.content, editorContent, saved.content);
  return {
    saved(args: {
      saved: AuthoredContentBase;
      sentContent: string | undefined;
      editorContent: string;
      authoredOn: AuthoredContentBase | null;
    }) {
      const { saved, sentContent, editorContent, authoredOn } = args;
      const seen = seenWhileSaving;
      seenWhileSaving = [];
      if (!saved.revision) return;
      unheld =
        authoredOn &&
        saved.content !== sentContent &&
        !holds(editorContent, saved, authoredOn) &&
        !seen.some((content) => holds(content, saved, authoredOn))
          ? { revision: saved.revision, base: authoredOn }
          : null;
    },
    /** The editor merged the saved body at `revision` into its own text. */
    merged(revision: string) {
      if (unheld?.revision === revision) unheld = null;
    },
    /** The editor's text changed without an edit here, as a peer's arrives. */
    observed(content: string, saved: AuthoredContentBase) {
      seenWhileSaving.push(content);
      if (seenWhileSaving.length > MAX_SEEN_WHILE_SAVING)
        seenWhileSaving.shift();
      if (!unheld || unheld.revision !== saved.revision) return;
      if (holds(content, saved, unheld.base)) unheld = null;
    },
    base(saved: AuthoredContentBase): AuthoredContentBase {
      return unheld && unheld.revision === saved.revision
        ? unheld.base
        : { revision: saved.revision, content: saved.content };
    },
    reset() {
      unheld = null;
      seenWhileSaving = [];
    },
  };
}
