export interface EditorCleanInput {
  liveMarkdown: string;
  normalize: (markdown: string) => string;
  saveQueued: boolean;
  saveInFlight: boolean;
  recoveryPending: boolean;
  /**
   * Bodies of the recovery drafts journaled for this page. `null` means the
   * journal could not be read, which is never clean.
   */
  journalContents: string[] | null;
  suggesting: boolean;
}

/**
 * The host's half of "this client holds no unsaved text". The toolkit hook adds
 * the other half, that the live doc still equals the snapshot it last adopted.
 * Any doubt answers false, because a false only keeps the peer settle wait.
 *
 * A journal draft that equals the live doc holds nothing the doc lacks. Two
 * signals look like they answer this and do not: `localContent` already holds
 * the incoming snapshot by the time the hook asks, and the edit-version
 * counters stay apart indefinitely after a no-op save of converged remote
 * content.
 */
export function isEditorContentClean(input: EditorCleanInput): boolean {
  if (
    input.suggesting ||
    input.saveQueued ||
    input.saveInFlight ||
    input.recoveryPending ||
    input.journalContents === null
  )
    return false;
  const live = input.normalize(input.liveMarkdown);
  return input.journalContents.every(
    (draft) => input.normalize(draft) === live,
  );
}
