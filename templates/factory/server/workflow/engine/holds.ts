import type { ItemState } from "../contract.js";

/**
 * A list, a group or a whole-list answer stands for inbox rows. While it waits
 * for the next run (parked, or set aside) those rows are parked too, so the
 * source does not offer them a second time and build a second list from them.
 * A held row carries nothing of its own: only which item it is held for.
 */
export function holdContext(
  heldBy: string,
  since: string,
): Record<string, unknown> {
  return {
    data: {},
    nodes: {},
    inbox: true,
    waitSince: since,
    kept: [],
    heldBy,
  };
}

/** The item a parked row is held for, or undefined when it is parked for itself. */
export function heldByOf(state: ItemState): string | undefined {
  const { heldBy } = state.context;
  return typeof heldBy === "string" ? heldBy : undefined;
}

/** The ids of the inbox rows an item stands for. */
export function rowsOf(item: {
  readonly inbox: boolean;
  readonly members?: readonly string[];
}): readonly string[] {
  return item.inbox ? [] : (item.members ?? []);
}
