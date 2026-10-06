import { bodyHoldsChanges } from "@shared/document-intent-merge";

export interface AuthoredContentBase {
  revision?: string;
  content: string;
}

// Forgetting an older observation only keeps the base held, which keeps text.
const MAX_SEEN = 16;

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
  // Only the editor's own reports say what it holds. The page's local copy
  // takes a save's answer, the other writer's text included, before the
  // editor receives that text.
  let editorContent: string | null = null;
  // The other writer's text can arrive and be deleted here before the save's
  // answer names the body that holds it. Saves queue, so one save's answer
  // leaves these for the next. Text seen before this tab's edit doesn't hold
  // that edit, so it can't release a later save.
  let seen: string[] = [];
  // The other writer's text can reach the editor before the save's answer,
  // or alongside typing here, so an exact match with the saved body misses
  // an editor that already holds it.
  const holds = (
    content: string,
    saved: AuthoredContentBase,
    base: AuthoredContentBase,
  ) =>
    content === saved.content ||
    bodyHoldsChanges(base.content, content, saved.content);
  return {
    saved(args: {
      saved: AuthoredContentBase;
      sentContent: string | undefined;
      authoredOn: AuthoredContentBase | null;
    }) {
      const { saved, sentContent, authoredOn } = args;
      if (!saved.revision) return;
      const shown = editorContent === null ? seen : [...seen, editorContent];
      unheld =
        authoredOn &&
        saved.content !== sentContent &&
        !shown.some((content) => holds(content, saved, authoredOn))
          ? { revision: saved.revision, base: authoredOn }
          : null;
    },
    /** The editor reported its text after an edit here. */
    edited(content: string) {
      editorContent = content;
    },
    /** The editor merged the saved body at `revision` into its own text. */
    merged(revision: string) {
      if (unheld?.revision === revision) unheld = null;
    },
    /** The editor's text changed without an edit here, as a peer's arrives. */
    observed(content: string, saved: AuthoredContentBase) {
      editorContent = content;
      seen.push(content);
      if (seen.length > MAX_SEEN) seen.shift();
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
      editorContent = null;
      seen = [];
    },
  };
}
