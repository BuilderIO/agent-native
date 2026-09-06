export interface PageSaveResult {
  contentPersisted: boolean;
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
    await retain("conflict");
    return result;
  }

  await clear();
  return result;
}
