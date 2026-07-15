export type AgentListSnapshot<TSummary> = {
  totalCount: number;
  truncated: boolean;
};

export function buildAgentListSnapshot<TItem, TSummary>(
  items: TItem[],
  cap: number,
  toSummary: (item: TItem) => TSummary,
): {
  snapshot: TItem[];
  list: AgentListSnapshot<TSummary> & { items: TSummary[] };
} {
  const snapshot = items.slice(0, cap);
  return {
    snapshot,
    list: {
      totalCount: items.length,
      truncated: items.length > cap,
      items: snapshot.map(toSummary),
    },
  };
}

export async function resolveSelectedFromList<
  TItem extends { id: string },
  TSummary,
>(input: {
  selectedId: string;
  items: TItem[];
  snapshot: TItem[];
  toSummary: (item: TItem) => TSummary;
  getById: (id: string) => Promise<TItem | null>;
  inSnapshotKey: string;
}): Promise<Record<string, unknown> | null> {
  const fromSnapshot = input.snapshot.find(
    (item) => item.id === input.selectedId,
  );
  if (fromSnapshot) {
    return {
      ...input.toSummary(fromSnapshot),
      [input.inSnapshotKey]: true,
    };
  }

  const fromList = input.items.find((item) => item.id === input.selectedId);
  if (fromList) {
    return {
      ...input.toSummary(fromList),
      [input.inSnapshotKey]: false,
    };
  }

  const fetched = await input.getById(input.selectedId);
  if (!fetched) return null;

  return {
    ...input.toSummary(fetched),
    [input.inSnapshotKey]: false,
  };
}

export function buildSelectionSnapshot<
  TItem extends { id: string },
  TSummary,
>(input: {
  selectedIds: string[];
  items: TItem[];
  toSummary: (item: TItem) => TSummary;
}): {
  selectionMode: true;
  selectedCount: number;
  selectedItems: TSummary[];
  selectedIdsNotInVisibleList: string[];
} {
  const selectedIdSet = new Set(input.selectedIds);
  const selectedInVisibleList = input.items.filter((item) =>
    selectedIdSet.has(item.id),
  );
  const visibleIdSet = new Set(selectedInVisibleList.map((item) => item.id));

  return {
    selectionMode: true,
    selectedCount: input.selectedIds.length,
    selectedItems: selectedInVisibleList.map(input.toSummary),
    selectedIdsNotInVisibleList: input.selectedIds.filter(
      (id) => !visibleIdSet.has(id),
    ),
  };
}
