export type InteractEntry =
  | { kind: "screen"; screenId: string }
  | { kind: "none"; reason: "no-pages" | "unknown-screen" };

/**
 * The page Interact opens on. A page the caller names (the route picker, a
 * prototype link, the agent) wins. Otherwise it is the selected page, then the
 * page an element is selected in, then the design's first visible page, so
 * entering Interact with nothing selected never lands on whichever screen
 * happened to be active last.
 *
 * Only pages count: the active file can be a board or code file, and Interact
 * on one of those shows the overview with nothing live.
 */
export function resolveInteractEntry({
  requestedScreenId,
  selectedScreenIds,
  selectionScreenId,
  screens,
  hiddenScreenIds,
}: {
  requestedScreenId?: string | null;
  selectedScreenIds: readonly string[];
  /** The page an element is selected in, null when no element is selected. */
  selectionScreenId: string | null;
  /** The design's pages, in canvas order. */
  screens: readonly { id: string }[];
  hiddenScreenIds: ReadonlySet<string>;
}): InteractEntry {
  const pageIds = new Set(screens.map((screen) => screen.id));
  if (requestedScreenId) {
    return pageIds.has(requestedScreenId)
      ? { kind: "screen", screenId: requestedScreenId }
      : { kind: "none", reason: "unknown-screen" };
  }
  const visible = (id: string) => pageIds.has(id) && !hiddenScreenIds.has(id);
  const chosen =
    selectedScreenIds.find(visible) ??
    (selectionScreenId && visible(selectionScreenId)
      ? selectionScreenId
      : undefined) ??
    screens.find((screen) => visible(screen.id))?.id;
  return chosen
    ? { kind: "screen", screenId: chosen }
    : { kind: "none", reason: "no-pages" };
}
