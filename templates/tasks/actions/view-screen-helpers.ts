import {
  buildAgentListSnapshot,
  buildSelectionSnapshot,
  resolveSelectedFromList,
} from "../shared/list-screen-snapshot.js";

export async function buildListViewScreen<
  TItem extends { id: string },
  TSummary,
>(input: {
  ownerEmail: string;
  cap: number;
  fetchItems: (ownerEmail: string) => Promise<TItem[]>;
  toSummary: (item: TItem) => TSummary;
  getById: (id: string) => Promise<TItem | null>;
  selection?: {
    /** Deep-link highlight from navigation (single row). */
    highlightId?: string;
    /** Bulk-select mode ids from app state. */
    bulkIds?: string[];
  };
  resolveSelectedMiss?: (
    id: string,
  ) => Promise<Record<string, unknown> | null>;
}): Promise<Record<string, unknown>> {
  const screen: Record<string, unknown> = {};
  const items = await input.fetchItems(input.ownerEmail);
  const { snapshot, list } = buildAgentListSnapshot(
    items,
    input.cap,
    input.toSummary,
  );

  screen.list = {
    totalCount: list.totalCount,
    truncated: list.truncated,
    items: list.items,
  };

  const highlightId = input.selection?.highlightId;
  if (highlightId) {
    const selectedItem = await resolveSelectedFromList({
      selectedId: highlightId,
      items,
      snapshot,
      toSummary: input.toSummary,
      getById: (id) => input.getById(id),
      inSnapshotKey: "inListSnapshot",
    });
    if (selectedItem) {
      screen.selectedItem = selectedItem;
    } else if (input.resolveSelectedMiss) {
      const fallback = await input.resolveSelectedMiss(highlightId);
      if (fallback) {
        screen.selectedItem = fallback;
      }
    }
  }

  const bulkIds = input.selection?.bulkIds;
  if (bulkIds && bulkIds.length > 0) {
    screen.selection = buildSelectionSnapshot({
      selectedIds: bulkIds,
      items,
      toSummary: input.toSummary,
    });
  }

  return screen;
}
