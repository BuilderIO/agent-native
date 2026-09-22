/**
 * Pure board logic: grouping, per-column totals, stage SLA, and the optimistic
 * move with its rollback. No React, no icons, no i18n.
 *
 * The bitemporal `crm_record_fields` table IS the stage history. The current
 * status row's `active_from` — surfaced per entry as `valuesSince[apiSlug]` by
 * `list-crm-list-entries`, and stored alongside the option's `target_days` —
 * is the whole input to time-in-stage. There is no separate stage-history
 * table and there must not be one; an action can compute the same overrun from
 * the same two fields.
 */

/** Column key for cards with no value for the grouping attribute. */
export const BOARD_UNGROUPED = "__ungrouped__";

/** A card shows at most this many configured attributes as plain rows. */
export const CARD_ATTRIBUTE_LIMIT = 3;

/** `crm_record_fields.actor_type`, restated locally so this module stays leaf. */
export type BoardActorType =
  | "user"
  | "agent"
  | "automation"
  | "provider"
  | "system";

export interface BoardOption {
  id: string;
  value: string;
  title: string;
  color?: string | undefined;
  position: number;
  archived: boolean;
  /** Stage SLA in days. Null means this stage is not time-boxed. */
  targetDays: number | null;
  celebrate: boolean;
}

export interface BoardCardAttribute {
  slug: string;
  label: string;
  attributeType: string;
  multi: boolean;
  options?: BoardOption[];
  config?: Record<string, unknown>;
  /** Raw decoded value; the renderer localizes it through the shared registry. */
  value: unknown;
}

export interface BoardCard {
  /** Entry id on a list board, record id on an object board. */
  id: string;
  recordId: string;
  title: string;
  subtitle: string | null;
  owner: string | null;
  /** Option value, or `BOARD_UNGROUPED` when the attribute has no value. */
  groupValue: string;
  /**
   * `active_from` of the current group value. `null` means no start is
   * recorded for it — which is NOT "started just now". The SLA reports
   * `unknown` for such a card rather than inventing an age.
   */
  groupSince: string | null;
  /**
   * The record's current revision, for an object board's record write. `null`
   * means this board never learned one — which is NOT "no concurrent change";
   * see `objectBoardMoveArgs`. A list board leaves it null: an entry write is
   * keyed by entry id and carries no record revision.
   */
  remoteRevision: string | null;
  amount: number | null;
  currencyCode: string | null;
  attributes: BoardCardAttribute[];
  /** Provenance of the card itself; drives the agent/automation affordance. */
  actorType: BoardActorType | null;
}

export type BoardColumnKind = "option" | "unset" | "archived" | "unknown";

export interface BoardColumn {
  /** Option value, or `BOARD_UNGROUPED`. Also the drop target identity. */
  key: string;
  option: BoardOption | null;
  kind: BoardColumnKind;
  cards: BoardCard[];
}

/**
 * One column per live option, then any archived or unrecognized value that
 * still holds cards, then the unset column last.
 *
 * A value with no live option gets its own column instead of falling into the
 * unset bucket: "this stage was retired" and "this card has no stage" are
 * different facts, and merging them hides data behind a plausible-looking
 * board.
 */
export function boardColumns(
  cards: readonly BoardCard[],
  options: readonly BoardOption[],
): BoardColumn[] {
  const live = [...options]
    .filter((option) => !option.archived)
    .sort((a, b) => a.position - b.position || a.value.localeCompare(b.value));
  const byValue = new Map(options.map((option) => [option.value, option]));

  const columns = new Map<string, BoardColumn>();
  for (const option of live) {
    columns.set(option.value, {
      key: option.value,
      option,
      kind: "option",
      cards: [],
    });
  }
  const extras: BoardColumn[] = [];
  const unset: BoardColumn = {
    key: BOARD_UNGROUPED,
    option: null,
    kind: "unset",
    cards: [],
  };

  for (const card of cards) {
    if (card.groupValue === BOARD_UNGROUPED || card.groupValue === "") {
      unset.cards.push(card);
      continue;
    }
    const existing = columns.get(card.groupValue);
    if (existing) {
      existing.cards.push(card);
      continue;
    }
    const option = byValue.get(card.groupValue) ?? null;
    const column: BoardColumn = {
      key: card.groupValue,
      option,
      kind: option ? "archived" : "unknown",
      cards: [card],
    };
    columns.set(card.groupValue, column);
    extras.push(column);
  }

  return [
    ...live.flatMap((option) => {
      const column = columns.get(option.value);
      return column ? [column] : [];
    }),
    ...extras,
    unset,
  ];
}

export interface BoardColumnTotals {
  count: number;
  /** Null when nothing summable is present, or when currencies are mixed. */
  sum: number | null;
  currencyCode: string | null;
  mixedCurrency: boolean;
  /** Cards with no amount — the sum does not cover them. */
  withoutAmount: number;
}

export function boardColumnTotals(
  cards: readonly BoardCard[],
): BoardColumnTotals {
  let sum = 0;
  let seen = 0;
  let withoutAmount = 0;
  let currencyCode: string | null = null;
  let mixedCurrency = false;

  for (const card of cards) {
    if (card.amount === null || !Number.isFinite(card.amount)) {
      withoutAmount += 1;
      continue;
    }
    sum += card.amount;
    seen += 1;
    if (card.currencyCode === null) continue;
    if (currencyCode === null) currencyCode = card.currencyCode;
    else if (currencyCode !== card.currencyCode) mixedCurrency = true;
  }

  return {
    count: cards.length,
    // Adding EUR to USD produces a confident wrong number, so a mixed column
    // reports no total instead of a meaningless one.
    sum: seen === 0 || mixedCurrency ? null : sum,
    currencyCode: mixedCurrency ? null : currencyCode,
    mixedCurrency,
    withoutAmount,
  };
}

export type BoardSla =
  | { status: "not-tracked" }
  | { status: "unknown"; reason: "no-start-recorded" | "unreadable-start" }
  | { status: "within"; days: number; targetDays: number }
  | { status: "overrun"; days: number; targetDays: number; overBy: number };

const DAY_MS = 86_400_000;

/**
 * Time-in-stage against the option's `target_days`, measured from the current
 * status row's `active_from`.
 */
export function boardCardSla(
  card: Pick<BoardCard, "groupSince">,
  option: BoardOption | null,
  now: Date,
): BoardSla {
  const targetDays = option?.targetDays ?? null;
  if (targetDays === null || targetDays <= 0) return { status: "not-tracked" };
  if (!card.groupSince) {
    return { status: "unknown", reason: "no-start-recorded" };
  }
  const since = Date.parse(card.groupSince);
  if (!Number.isFinite(since)) {
    return { status: "unknown", reason: "unreadable-start" };
  }
  const days = Math.floor((now.getTime() - since) / DAY_MS);
  if (days > targetDays) {
    return { status: "overrun", days, targetDays, overBy: days - targetDays };
  }
  return { status: "within", days, targetDays };
}

/** Cards a board should surface first: every stage-SLA overrun, worst first. */
export function boardOverruns(
  columns: readonly BoardColumn[],
  now: Date,
): Array<{ card: BoardCard; sla: Extract<BoardSla, { status: "overrun" }> }> {
  return columns
    .flatMap((column) =>
      column.cards.flatMap((card) => {
        const sla = boardCardSla(card, column.option, now);
        return sla.status === "overrun" ? [{ card, sla }] : [];
      }),
    )
    .sort((a, b) => b.sla.overBy - a.sla.overBy);
}

/**
 * The card moved into `toValue`, as a new array. Throws on an unknown id
 * rather than returning the untouched list, which a caller cannot tell from a
 * successful no-op move.
 */
export function applyBoardMove(
  cards: readonly BoardCard[],
  cardId: string,
  toValue: string,
  now: string,
): BoardCard[] {
  if (!cards.some((card) => card.id === cardId)) {
    throw new Error(`Board card "${cardId}" is not on this board.`);
  }
  return cards.map((card) =>
    card.id === cardId
      ? { ...card, groupValue: toValue, groupSince: now }
      : card,
  );
}

export interface BoardMoveResult {
  moved: boolean;
  /** Present only when the commit failed and the board was rolled back. */
  error?: unknown;
}

/**
 * Optimistic stage move: paint it, then commit. A failed commit re-applies the
 * pre-move snapshot, so the card visibly returns to the column it came from.
 */
export async function moveBoardCard(input: {
  cards: readonly BoardCard[];
  cardId: string;
  toValue: string;
  now: string;
  apply: (next: BoardCard[]) => void;
  commit: (move: { card: BoardCard; toValue: string }) => Promise<unknown>;
}): Promise<BoardMoveResult> {
  const card = input.cards.find((entry) => entry.id === input.cardId);
  if (!card)
    throw new Error(`Board card "${input.cardId}" is not on this board.`);
  if (card.groupValue === input.toValue) return { moved: false };

  const snapshot = [...input.cards];
  input.apply(
    applyBoardMove(input.cards, input.cardId, input.toValue, input.now),
  );
  try {
    await input.commit({ card, toValue: input.toValue });
    return { moved: true };
  } catch (error) {
    input.apply(snapshot);
    return { moved: false, error };
  }
}

/** The value an action should be sent for a column: unset clears the field. */
export function moveValueForColumn(columnKey: string): string | null {
  return columnKey === BOARD_UNGROUPED ? null : columnKey;
}

/**
 * `update-crm-record` args for an object-board move.
 *
 * A native local write is refused without the record's current revision, so
 * the card's revision is carried through here. When the card has none the key
 * is omitted rather than sent as `""` or `null`: an invented revision would
 * pass as a real one and turn a concurrent edit into a silent overwrite, and
 * the action's own "refresh the record" error is the honest outcome. It stays
 * distinguishable from a stale revision, which the native adapter reports as a
 * conflict instead.
 */
export function objectBoardMoveArgs(
  card: Pick<BoardCard, "recordId" | "remoteRevision">,
  groupSlug: string,
  toValue: string,
) {
  return {
    recordId: card.recordId,
    target: "local" as const,
    fields: { [groupSlug]: moveValueForColumn(toValue) },
    ...(card.remoteRevision
      ? { expectedRemoteRevision: card.remoteRevision }
      : {}),
  };
}

/**
 * The currency attribute a column header sums. Prefers one named by the view's
 * columns so a board follows what the view already shows.
 */
export function pickCurrencyAttribute<
  T extends { id: string; apiSlug: string; attributeType: string },
>(attributes: readonly T[], preferredIds: readonly string[] = []): T | null {
  const currency = attributes.filter(
    (attribute) => attribute.attributeType === "currency",
  );
  const preferred = currency.find(
    (attribute) =>
      preferredIds.includes(attribute.id) ||
      preferredIds.includes(attribute.apiSlug),
  );
  return preferred ?? currency[0] ?? null;
}

/**
 * Up to `CARD_ATTRIBUTE_LIMIT` attributes a card shows as plain rows. The
 * grouping and currency attributes get their own dedicated place on the card,
 * so excluding them here keeps a value from appearing twice. Prefers the
 * view's own column order; whatever is left is filled in by `position`.
 */
export function pickCardAttributes<
  T extends {
    id: string;
    apiSlug: string;
    attributeType: string;
    position: number;
  },
>(
  attributes: readonly T[],
  excludeIds: ReadonlySet<string>,
  preferredIds: readonly string[] = [],
): T[] {
  const eligible = attributes.filter(
    (attribute) =>
      !excludeIds.has(attribute.id) &&
      attribute.attributeType !== "interaction",
  );
  const preferred = preferredIds.flatMap((id) => {
    const match = eligible.find(
      (attribute) => attribute.id === id || attribute.apiSlug === id,
    );
    return match ? [match] : [];
  });
  const rest = eligible
    .filter((attribute) => !preferred.includes(attribute))
    .sort((a, b) => a.position - b.position);
  return [...preferred, ...rest].slice(0, CARD_ATTRIBUTE_LIMIT);
}

/**
 * A card's summable amount, read only from the view's currency attribute.
 * `null` covers "this view has no currency attribute" and "the value under it
 * is missing or unreadable" alike — a column total must not fold either into
 * a silent zero, and this must never fall back to an untyped/legacy field.
 */
export function cardAmountFor(
  currencyAttribute: { apiSlug: string } | null,
  values: Readonly<Record<string, unknown>>,
): number | null {
  if (!currencyAttribute) return null;
  const value = values[currencyAttribute.apiSlug];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
