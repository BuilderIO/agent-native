/**
 * A save names the revision of the cell the editor last rendered. A cell whose
 * stored revision has moved on was changed by someone else, so the write is
 * refused instead of overwriting their text. No expected revision means the
 * caller made no claim, so the write is not checked.
 */
export function isCellRevisionCurrent(
  stored: { updatedAt: string },
  expectedUpdatedAt: string | undefined,
): boolean {
  if (expectedUpdatedAt === undefined) return true;
  return stored.updatedAt === expectedUpdatedAt;
}
