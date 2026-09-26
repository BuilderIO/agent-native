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
  outcome?: "superseded";
}

export async function savePageWithRecovery({
  save,
  retain,
  clear,
}: {
  save: () => Promise<PageSaveResult>;
  retain: (reason: "conflict" | null) => Promise<void>;
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
    await retain("conflict");
    return result;
  }

  await clear();
  return result;
}
