/**
 * Folders the sidebar opened for a page being created or moved into them, by
 * folder ID. A closed folder opens with the first write into it and closes
 * again once every write into it has failed, unless the person opened or
 * closed it in the meantime.
 */
export type ParentReveals = Map<string, ParentReveal>;

type ParentReveal = {
  pendingCount: number;
  initiallyExpanded: boolean;
  keepExpanded: boolean;
};

/** A write into `parentId` starts. True when the folder should open for it. */
export function startParentReveal(
  reveals: ParentReveals,
  parentId: string,
  expanded: boolean,
): boolean {
  const reveal = reveals.get(parentId) ?? {
    pendingCount: 0,
    initiallyExpanded: expanded,
    keepExpanded: false,
  };
  reveal.pendingCount += 1;
  reveals.set(parentId, reveal);
  return !reveal.initiallyExpanded && reveal.pendingCount === 1;
}

/** A write into `parentId` settled. True when the folder should close again. */
export function settleParentReveal(
  reveals: ParentReveals,
  parentId: string,
  succeeded: boolean,
): boolean {
  const reveal = reveals.get(parentId);
  if (!reveal) return false;
  reveal.pendingCount -= 1;
  reveal.keepExpanded ||= succeeded;
  if (reveal.pendingCount > 0) return false;
  reveals.delete(parentId);
  return !reveal.initiallyExpanded && !reveal.keepExpanded;
}

/**
 * The person opened or closed `documentId` themselves, so no write into it
 * that settles later closes it.
 */
export function keepParentRevealAsToggled(
  reveals: ParentReveals,
  documentId: string,
) {
  const reveal = reveals.get(documentId);
  if (reveal) reveal.keepExpanded = true;
}
