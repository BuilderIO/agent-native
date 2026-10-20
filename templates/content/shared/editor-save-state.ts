// What an open editor publishes in its collaboration awareness state about its
// own edits. Persisted awareness is a save hint; only a fresh per-client
// challenge can establish that no newer local input is waiting to save.
export type EditorSaveState =
  | {
      unsavedEdits: true;
      savedRevision: null;
      savedTitle: null;
      savedTitleAt: null;
    }
  | {
      unsavedEdits: false;
      savedRevision: string;
      savedTitle: string;
      savedTitleAt: string | null;
    };

const UNSAVED: EditorSaveState = {
  unsavedEdits: true,
  savedRevision: null,
  savedTitle: null,
  savedTitleAt: null,
};

// The watermarks are written only from server-confirmed data (the loaded
// document, a save acknowledgment, an adopted server version), so "saved" here
// always names a revision the server has acknowledged. Local idle time never
// counts: text the editor holds that differs from that revision is unsaved.
export function editorSaveState(input: {
  saveQueued: boolean;
  saveInFlight: boolean;
  recoveryPending: boolean;
  localTitle: string;
  localContent: string;
  savedTitle: { title: string; updatedAt: string | null };
  savedContent: { content: string; revision?: string | null };
}): EditorSaveState {
  const revision = input.savedContent.revision;
  if (
    input.saveQueued ||
    input.saveInFlight ||
    input.recoveryPending ||
    !revision ||
    input.localTitle !== input.savedTitle.title ||
    input.localContent !== input.savedContent.content
  ) {
    return UNSAVED;
  }
  return {
    unsavedEdits: false,
    savedRevision: revision,
    savedTitle: input.savedTitle.title,
    savedTitleAt: input.savedTitle.updatedAt,
  };
}

export function publishesEditorSaveState(
  awarenessState: Record<string, unknown>,
  state: EditorSaveState,
): boolean {
  return (
    awarenessState.unsavedEdits === state.unsavedEdits &&
    awarenessState.savedRevision === state.savedRevision &&
    awarenessState.savedTitle === state.savedTitle &&
    awarenessState.savedTitleAt === state.savedTitleAt
  );
}

export type ClaimedEditorSave = {
  revision: string;
  title: string;
  titleUpdatedAt: string | null;
};

// An awareness state claims a save only when it says so in full. Older editors
// omit the fields and an editor with unsaved edits sends nulls; neither claims
// anything, so the server asks that editor to save.
export function claimedEditorSave(state: {
  unsavedEdits?: unknown;
  savedRevision?: unknown;
  savedTitle?: unknown;
  savedTitleAt?: unknown;
}): ClaimedEditorSave | null {
  if (state.unsavedEdits !== false) return null;
  if (
    typeof state.savedRevision !== "string" ||
    typeof state.savedTitle !== "string" ||
    (state.savedTitleAt !== null && typeof state.savedTitleAt !== "string")
  ) {
    return null;
  }
  return {
    revision: state.savedRevision,
    title: state.savedTitle,
    titleUpdatedAt: state.savedTitleAt,
  };
}
