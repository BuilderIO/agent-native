export interface AuthoredContentBase {
  revision?: string;
  content: string;
}

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
  return {
    saved(args: {
      saved: AuthoredContentBase;
      editorContent: string | undefined;
      authoredOn: AuthoredContentBase | null;
    }) {
      const { saved, editorContent, authoredOn } = args;
      if (!saved.revision) return;
      unheld =
        saved.content !== editorContent && authoredOn
          ? { revision: saved.revision, base: authoredOn }
          : null;
    },
    /** The editor merged the saved body at `revision` into its own text. */
    merged(revision: string) {
      if (unheld?.revision === revision) unheld = null;
    },
    /** The editor's text changed without an edit here, as a peer's arrives. */
    observed(content: string, saved: AuthoredContentBase) {
      if (unheld?.revision === saved.revision && content === saved.content) {
        unheld = null;
      }
    },
    base(saved: AuthoredContentBase): AuthoredContentBase {
      return unheld && unheld.revision === saved.revision
        ? unheld.base
        : { revision: saved.revision, content: saved.content };
    },
    reset() {
      unheld = null;
    },
  };
}
