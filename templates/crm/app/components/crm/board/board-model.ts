
export const BOARD_UNGROUPED = "__ungrouped__";

export const CARD_ATTRIBUTE_LIMIT = 3;

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
  value: unknown;
}

export interface BoardCard {
  id: string;
  recordId: string;
  title: string;
  subtitle: string | null;
  owner: string | null;
  groupValue: string;
  groupSince: string | null;
  remoteRevision: string | null;
  amount: number | null;
  currencyCode: string | null;
  attributes: BoardCardAttribute[];
  actorType: BoardActorType | null;
}

export type BoardColumnKind = "option" | "unset" | "archived" | "unknown";

export interface BoardColumn {
  key: string;
  option: BoardOption | null;
  kind: BoardColumnKind;
  cards: BoardCard[];
}

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
  sum: number | null;
  currencyCode: string | null;
  mixedCurrency: boolean;
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
  error?: unknown;
}

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

export function moveValueForColumn(columnKey: string): string | null {
  return columnKey === BOARD_UNGROUPED ? null : columnKey;
}

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

export function cardAmountFor(
  currencyAttribute: { apiSlug: string } | null,
  values: Readonly<Record<string, unknown>>,
): number | null {
  if (!currencyAttribute) return null;
  const value = values[currencyAttribute.apiSlug];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
