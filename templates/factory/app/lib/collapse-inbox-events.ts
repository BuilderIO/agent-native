export interface CollapsibleInboxEvent {
  id: string;
  action?: string;
  summary?: string | null;
}

/** Keep the latest of consecutive identical action+summary rows. */
export function collapseConsecutiveInboxEvents<T extends CollapsibleInboxEvent>(
  events: readonly T[],
): T[] {
  const collapsed: T[] = [];
  for (const event of events) {
    const last = collapsed[collapsed.length - 1];
    if (
      last &&
      last.action === event.action &&
      last.summary === event.summary
    ) {
      collapsed[collapsed.length - 1] = event;
      continue;
    }
    collapsed.push(event);
  }
  return collapsed;
}
