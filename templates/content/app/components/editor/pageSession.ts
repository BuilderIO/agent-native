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

/**
 * Run one primary Page save and retain only rejected or conflict-blocked edits.
 * Cleanup failures do not create a second draft after the primary write landed.
 */
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
