export function mayClearRecoveryDraft(
  draft: { title: string; content: string } | null,
  persisted: { title: string; content: string },
): boolean {
  return (
    draft !== null &&
    draft.title === persisted.title &&
    draft.content === persisted.content
  );
}

/**
 * Whether a later save by the same editor session already carries a recovery
 * draft it wrote when an earlier save did not land. Only those drafts qualify:
 * others (conflicts, displaced text) may hold text the editor no longer has.
 */
export function ownRecoveryDraftSupersededBySave(
  draft: {
    editorSessionId: string | null;
    editGeneration: number | null;
    supersedable?: boolean;
  },
  save: { editorSessionId: string; editGeneration: number },
): boolean {
  return (
    draft.supersedable === true &&
    draft.editorSessionId === save.editorSessionId &&
    draft.editGeneration !== null &&
    draft.editGeneration <= save.editGeneration
  );
}

export interface PageSaveResult {
  contentPersisted: boolean;
  outcome?: "superseded" | "pending_preservation";
  recoveryDraft?: {
    title: string;
    content: string;
    baseContent?: string;
    baseUpdatedAt?: string | null;
    baseRevision?: string;
  };
}

export async function savePageWithRecovery({
  save,
  retain,
  clear,
}: {
  save: () => Promise<PageSaveResult>;
  retain: (reason: "conflict" | null, result?: PageSaveResult) => Promise<void>;
  clear: () => Promise<void>;
}): Promise<PageSaveResult> {
  let result: PageSaveResult;
  try {
    result = await save();
  } catch (error) {
    await retain(null);
    throw error;
  }

  if (!result.contentPersisted) {
    if (result.outcome === "superseded") return result;
    await retain(result.recoveryDraft ? null : "conflict", result);
    return result;
  }

  await clear();
  return result;
}
