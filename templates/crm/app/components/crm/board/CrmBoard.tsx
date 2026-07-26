/**
 * The CRM board: a list's entries, or an object's records, in one column per
 * option of a `status` attribute.
 *
 * Stage history is not a separate table. On a list board the current status
 * row's `active_from` arrives as `valuesSince[slug]`, and the option's
 * `target_days` comes with the attribute — so the SLA the cards show is
 * exactly what an action reading `crm_record_fields` would compute.
 */

import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconClock,
  IconClockExclamation,
  IconGripVertical,
} from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { LoadingRows } from "@/components/crm/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  BOARD_UNGROUPED,
  boardCardSla,
  boardColumns,
  boardColumnTotals,
  boardOverruns,
  moveBoardCard,
  moveValueForColumn,
  pickCurrencyAttribute,
  type BoardActorType,
  type BoardCard,
  type BoardColumn,
  type BoardOption,
} from "./board-model";
import { toEntryFilters, type EntryFilter } from "./entry-filter";

// ---------------------------------------------------------------------------
// Action shapes
// ---------------------------------------------------------------------------

interface BoardAttributeOption {
  id: string;
  value: string;
  title: string;
  color?: string;
  position: number;
  archived: boolean;
  targetDays?: number | null;
  celebrate?: boolean;
}

export interface BoardAttribute {
  id: string;
  apiSlug: string;
  label: string;
  attributeType: string;
  multi: boolean;
  position: number;
  options?: BoardAttributeOption[];
  config?: Record<string, unknown>;
}

interface AttributesResponse {
  attributes: BoardAttribute[];
}

interface EntriesResponse {
  entries: Array<{
    id: string;
    recordId: string;
    createdByActorType: string | null;
    record: {
      id: string;
      displayName: string;
      primaryEmail: string | null;
      domain: string | null;
      ownerName: string | null;
      amount: number | null;
      currencyCode: string | null;
    };
    values: Record<string, unknown>;
    valuesSince: Record<string, string>;
  }>;
  complete: boolean;
}

interface RecordsResponse {
  records: Array<{
    id: string;
    displayName: string;
    subtitle?: string;
    owner?: string;
  }>;
  complete: boolean;
}

const PAGE_LIMIT = 100;
const CARD_ATTRIBUTE_LIMIT = 3;

export interface CrmBoardTarget {
  kind: "list" | "object";
  /** The list id for a list target, the object type for an object target. */
  id: string;
  /** Canonical record kind, for an object target. */
  recordKind?: string | undefined;
}

export interface CrmBoardProps {
  target: CrmBoardTarget;
  groupByAttributeId?: string | undefined;
  /** The view's stored filter tree, applied server-side. */
  filter?: unknown;
  mode: "table" | "board";
  /** Attribute ids the view shows, used to pick the card and money columns. */
  columnAttributeIds?: readonly string[];
  /**
   * Reports which status attribute the board resolved to group by, and which
   * ones it could use. A saved board view must persist an explicit
   * `groupByAttributeId`, so the toolbar needs the id the board fell back to.
   */
  onGrouping?: (state: {
    statusAttributes: Array<{ id: string; label: string }>;
    groupAttributeId: string | null;
  }) => void;
}

interface BoardData {
  isLoading: boolean;
  error: unknown;
  statusAttributes: BoardAttribute[];
  groupAttribute: BoardAttribute | null;
  options: BoardOption[];
  cards: BoardCard[];
  complete: boolean;
  refetch: () => void;
  commit: (move: { card: BoardCard; toValue: string }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Shared derivation
// ---------------------------------------------------------------------------

function toBoardOptions(attribute: BoardAttribute | null): BoardOption[] {
  return (attribute?.options ?? []).map((option) => ({
    id: option.id,
    value: option.value,
    title: option.title,
    color: option.color,
    position: option.position,
    archived: option.archived,
    targetDays: option.targetDays ?? null,
    celebrate: option.celebrate ?? false,
  }));
}

function pickGroupAttribute(
  attributes: readonly BoardAttribute[],
  groupByAttributeId: string | undefined,
): BoardAttribute | null {
  if (groupByAttributeId) {
    return (
      attributes.find(
        (attribute) =>
          attribute.id === groupByAttributeId ||
          attribute.apiSlug === groupByAttributeId,
      ) ?? null
    );
  }
  return (
    attributes.find((attribute) => attribute.attributeType === "status") ?? null
  );
}

function currencyCodeOf(attribute: BoardAttribute | null): string | null {
  const currency = attribute?.config?.currency;
  if (!currency || typeof currency !== "object") return null;
  const code = (currency as { code?: unknown }).code;
  return typeof code === "string" && code ? code : null;
}

function numberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const ACTOR_TYPES: readonly BoardActorType[] = [
  "user",
  "agent",
  "automation",
  "provider",
  "system",
];

function toActorType(value: unknown): BoardActorType | null {
  return typeof value === "string" &&
    (ACTOR_TYPES as readonly string[]).includes(value)
    ? (value as BoardActorType)
    : null;
}

function statusAttributesOf(
  attributes: readonly BoardAttribute[],
): BoardAttribute[] {
  return attributes.filter((attribute) => attribute.attributeType === "status");
}

function cardAttributes(
  attributes: readonly BoardAttribute[],
  excludeIds: ReadonlySet<string>,
  preferredIds: readonly string[],
): BoardAttribute[] {
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
  const rest = eligible.filter((attribute) => !preferred.includes(attribute));
  return [...preferred, ...rest].slice(0, CARD_ATTRIBUTE_LIMIT);
}

// ---------------------------------------------------------------------------
// List target
// ---------------------------------------------------------------------------

function useListBoard(props: CrmBoardProps, enabled: boolean): BoardData {
  const attributesQuery = useActionQuery<AttributesResponse>(
    "list-crm-attributes" as never,
    { target: "list", targetId: props.target.id, limit: 200 } as never,
    { enabled },
  );
  const attributes = attributesQuery.data?.attributes ?? [];
  const groupAttribute = pickGroupAttribute(
    attributes,
    props.groupByAttributeId,
  );

  // The filter is translated against the list's own attributes, so the entries
  // call waits for them. One extra round trip on first paint; every later
  // filter change hits the cached attribute query.
  let filters: EntryFilter[] = [];
  let filterError: unknown;
  try {
    filters = attributesQuery.isSuccess
      ? toEntryFilters(props.filter, attributes)
      : [];
  } catch (error) {
    filterError = error;
  }

  const entriesQuery = useQuery<EntriesResponse>({
    queryKey: ["crm-board-entries", props.target.id, JSON.stringify(filters)],
    queryFn: ({ signal }) =>
      callAction<EntriesResponse>(
        "list-crm-list-entries" as never,
        {
          listId: props.target.id,
          ...(filters.length ? { filters } : {}),
          limit: PAGE_LIMIT,
        } as never,
        { signal },
      ),
    enabled: enabled && attributesQuery.isSuccess && !filterError,
  });

  const currencyAttribute = pickCurrencyAttribute(
    attributes,
    props.columnAttributeIds ?? [],
  );
  const excluded = new Set(
    [groupAttribute?.id, currencyAttribute?.id].filter(
      (id): id is string => typeof id === "string",
    ),
  );
  const shown = cardAttributes(
    attributes,
    excluded,
    props.columnAttributeIds ?? [],
  );

  const groupSlug = groupAttribute?.apiSlug ?? "";
  const entries = entriesQuery.data?.entries;
  const shownKey = shown.map((attribute) => attribute.apiSlug).join(" ");
  const cards = useMemo<BoardCard[]>(() => {
    if (!groupSlug) return [];
    return (entries ?? []).map((entry) => {
      const raw = entry.values[groupSlug];
      return {
        id: entry.id,
        recordId: entry.recordId,
        title: entry.record.displayName,
        subtitle: entry.record.domain ?? entry.record.primaryEmail ?? null,
        owner: entry.record.ownerName ?? null,
        groupValue: typeof raw === "string" && raw ? raw : BOARD_UNGROUPED,
        groupSince: entry.valuesSince[groupSlug] ?? null,
        amount: currencyAttribute
          ? numberOr(entry.values[currencyAttribute.apiSlug])
          : numberOr(entry.record.amount),
        currencyCode: currencyAttribute
          ? currencyCodeOf(currencyAttribute)
          : entry.record.currencyCode,
        attributes: shown.map((attribute) => ({
          slug: attribute.apiSlug,
          label: attribute.label,
          value: entry.values[attribute.apiSlug] ?? null,
        })),
        actorType: toActorType(entry.createdByActorType),
      };
    });
  }, [entries, groupSlug, currencyAttribute?.id, shownKey]);

  return {
    isLoading: attributesQuery.isLoading || entriesQuery.isLoading,
    error: filterError ?? attributesQuery.error ?? entriesQuery.error,
    statusAttributes: statusAttributesOf(attributes),
    groupAttribute,
    options: toBoardOptions(groupAttribute),
    cards,
    complete: entriesQuery.data?.complete ?? true,
    refetch: () => void entriesQuery.refetch(),
    commit: ({ card, toValue }) =>
      callAction(
        "update-crm-list-entry" as never,
        {
          entryId: card.id,
          values: { [groupSlug]: moveValueForColumn(toValue) },
        } as never,
      ),
  };
}

// ---------------------------------------------------------------------------
// Object target
//
// A record summary carries no attribute values, so a column is one filtered
// `list-crm-records` call rather than one page grouped in the browser. Each
// column is therefore a real server-side result, not a slice of one page.
// ---------------------------------------------------------------------------

function useObjectBoard(props: CrmBoardProps, enabled: boolean): BoardData {
  const attributesQuery = useActionQuery<AttributesResponse>(
    "list-crm-attributes" as never,
    { target: "object", targetId: props.target.id, limit: 200 } as never,
    { enabled },
  );
  const attributes = attributesQuery.data?.attributes ?? [];
  const groupAttribute = pickGroupAttribute(
    attributes,
    props.groupByAttributeId,
  );
  const optionKey = JSON.stringify(
    toBoardOptions(groupAttribute)
      .filter((option) => !option.archived)
      .map((option) => option.value),
  );

  const buckets = useMemo<Array<{ key: string; value: string | null }>>(() => {
    const values = JSON.parse(optionKey) as string[];
    return [
      ...values.map((value) => ({ key: value, value })),
      { key: BOARD_UNGROUPED, value: null },
    ];
  }, [optionKey]);

  const groupAttributeId = groupAttribute?.id ?? "";
  const filterKey = JSON.stringify(props.filter ?? null);
  const results = useQueries({
    queries: buckets.map((bucket) => ({
      queryKey: [
        "crm-board-records",
        props.target.id,
        groupAttributeId,
        bucket.key,
        filterKey,
      ],
      enabled: enabled && Boolean(groupAttributeId),
      queryFn: () =>
        callAction<RecordsResponse>(
          "list-crm-records" as never,
          {
            ...(props.target.recordKind
              ? { kind: props.target.recordKind }
              : {}),
            filter: {
              op: "and",
              conditions: [
                ...conditionsOf(props.filter),
                {
                  attributeId: groupAttributeId,
                  condition: bucket.value === null ? "is-empty" : "is",
                  ...(bucket.value === null ? {} : { value: bucket.value }),
                },
              ],
            },
            limit: PAGE_LIMIT,
          } as never,
        ),
    })),
  });

  const dataKey = results.map((result) => result.dataUpdatedAt).join(" ");
  const cards = useMemo<BoardCard[]>(
    () =>
      results.flatMap((result, index) => {
        const bucket = buckets[index];
        if (!bucket) return [];
        return (result.data?.records ?? []).map((record) => ({
          id: record.id,
          recordId: record.id,
          title: record.displayName,
          subtitle: record.subtitle ?? null,
          owner: record.owner ?? null,
          groupValue: bucket.value ?? BOARD_UNGROUPED,
          // A record summary reports no `active_from` for the status value, so
          // the SLA stays `unknown` rather than being derived from `updatedAt`.
          groupSince: null,
          amount: null,
          currencyCode: null,
          attributes: [],
          actorType: null,
        }));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, buckets],
  );

  const groupSlug = groupAttribute?.apiSlug ?? "";
  return {
    isLoading:
      attributesQuery.isLoading || results.some((result) => result.isLoading),
    error:
      attributesQuery.error ?? results.find((result) => result.error)?.error,
    statusAttributes: statusAttributesOf(attributes),
    groupAttribute,
    options: toBoardOptions(groupAttribute),
    cards,
    complete: results.every((result) => result.data?.complete ?? true),
    refetch: () => {
      for (const result of results) void result.refetch();
    },
    commit: ({ card, toValue }) =>
      callAction(
        "update-crm-record" as never,
        {
          recordId: card.recordId,
          target: "local",
          fields: { [groupSlug]: moveValueForColumn(toValue) },
        } as never,
      ),
  };
}

function conditionsOf(filter: unknown): unknown[] {
  if (!filter || typeof filter !== "object") return [];
  const conditions = (filter as { conditions?: unknown }).conditions;
  return Array.isArray(conditions) ? conditions : [];
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function CrmBoard(props: CrmBoardProps) {
  const t = useT();
  const isList = props.target.kind === "list";
  const listBoard = useListBoard(props, isList);
  const objectBoard = useObjectBoard(props, !isList);
  const data = isList ? listBoard : objectBoard;

  const [optimistic, setOptimistic] = useState<BoardCard[] | null>(null);
  useEffect(() => setOptimistic(null), [data.cards]);

  const onGrouping = props.onGrouping;
  const statusAttributes = data.statusAttributes;
  const statusKey = statusAttributes.map((attribute) => attribute.id).join(",");
  const groupAttributeId = data.groupAttribute?.id ?? null;
  useEffect(() => {
    onGrouping?.({
      statusAttributes: statusAttributes.map((attribute) => ({
        id: attribute.id,
        label: attribute.label,
      })),
      groupAttributeId,
    });
    // `statusKey` stands in for the attribute array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onGrouping, statusKey, groupAttributeId]);

  const cards = optimistic ?? data.cards;
  const columns = useMemo(
    () => boardColumns(cards, data.options),
    [cards, data.options],
  );
  // One clock per rendered board so every card's age is measured consistently.
  const now = useMemo(() => new Date(), [cards]);
  const overruns = useMemo(() => boardOverruns(columns, now), [columns, now]);

  async function move(cardId: string, toValue: string) {
    const result = await moveBoardCard({
      cards,
      cardId,
      toValue,
      now: new Date().toISOString(),
      apply: setOptimistic,
      commit: data.commit,
    });
    if (result.error) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : t("board.moveFailed"),
      );
      return;
    }
    if (result.moved) data.refetch();
  }

  if (data.error) {
    return (
      <BoardNotice
        message={
          data.error instanceof Error
            ? data.error.message
            : t("board.loadFailed")
        }
        onRetry={data.refetch}
      />
    );
  }
  if (data.isLoading) return <LoadingRows rows={4} />;
  if (!data.groupAttribute) {
    return <BoardNotice message={t("board.noStatusAttribute")} />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 sm:px-7">
        <span className="text-xs text-muted-foreground">
          {t("board.groupedBy", { attribute: data.groupAttribute.label })}
        </span>
        {overruns.length ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 font-normal text-amber-700 dark:text-amber-400"
          >
            <IconAlertTriangle className="size-3.5" />
            {t("board.overrunSummary", { count: overruns.length })}
          </Badge>
        ) : null}
        {data.complete ? null : (
          <span className="text-xs text-muted-foreground">
            {t("board.partialPage", { limit: PAGE_LIMIT })}
          </span>
        )}
      </div>
      {props.mode === "table" ? (
        <BoardTable columns={columns} now={now} />
      ) : (
        <div className="flex gap-3 overflow-x-auto p-5 sm:p-7">
          {columns.map((column, index) => (
            <BoardColumnView
              key={column.key}
              column={column}
              now={now}
              onDropCard={(cardId) => void move(cardId, column.key)}
              onMoveCard={(cardId, offset) => {
                const next = columns[index + offset];
                if (next) void move(cardId, next.key);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BoardNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div className="m-5 flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card p-4 sm:m-7">
      <IconAlertTriangle className="size-4 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("board.retry")}
        </Button>
      ) : null}
    </div>
  );
}

function BoardColumnView({
  column,
  now,
  onDropCard,
  onMoveCard,
}: {
  column: BoardColumn;
  now: Date;
  onDropCard: (cardId: string) => void;
  onMoveCard: (cardId: string, offset: -1 | 1) => void;
}) {
  const t = useT();
  const [isOver, setIsOver] = useState(false);
  const totals = boardColumnTotals(column.cards);

  return (
    <section
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 ${
        isOver ? "border-primary/60 bg-primary/5" : "border-border/70"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        const cardId = event.dataTransfer.getData("text/plain");
        if (cardId) onDropCard(cardId);
      }}
    >
      <header className="flex flex-col gap-1 border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {column.option?.color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: column.option.color }}
              />
            ) : null}
            <p className="truncate text-sm font-medium">
              {columnTitle(column, t)}
            </p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {totals.count}
          </span>
        </div>
        <ColumnTotals totals={totals} />
      </header>
      <div className="flex min-h-24 flex-col gap-2 p-2">
        {column.cards.map((card) => (
          <BoardCardView
            key={card.id}
            card={card}
            option={column.option}
            columnLabel={columnTitle(column, t)}
            now={now}
            onMove={(offset) => onMoveCard(card.id, offset)}
          />
        ))}
        {column.cards.length ? null : (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            {t("board.columnEmpty")}
          </p>
        )}
      </div>
    </section>
  );
}

function ColumnTotals({
  totals,
}: {
  totals: ReturnType<typeof boardColumnTotals>;
}) {
  const t = useT();
  if (totals.mixedCurrency) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("board.mixedCurrency")}
      </p>
    );
  }
  if (totals.sum === null) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground">
        {formatMoney(totals.sum, totals.currencyCode)}
      </span>
      {totals.withoutAmount ? (
        <span>{t("board.withoutAmount", { count: totals.withoutAmount })}</span>
      ) : null}
    </p>
  );
}

function BoardCardView({
  card,
  option,
  columnLabel,
  now,
  onMove,
}: {
  card: BoardCard;
  option: BoardOption | null;
  columnLabel: string;
  now: Date;
  onMove: (offset: -1 | 1) => void;
}) {
  const t = useT();
  const sla = boardCardSla(card, option, now);
  const shown = card.attributes.flatMap((attribute) => {
    const text = formatValue(attribute.value, t);
    return text === null ? [] : [{ ...attribute, text }];
  });

  return (
    <article
      draggable
      tabIndex={0}
      aria-label={t("board.cardAria", {
        name: card.title,
        column: columnLabel,
      })}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onKeyDown={(event) => {
        // Keyboard parity with the drag: a card can be moved without a mouse.
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onMove(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      className="group cursor-grab rounded-md border border-border/70 bg-card p-2.5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5">
        <IconGripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/records/${encodeURIComponent(card.recordId)}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {card.title}
          </Link>
          {card.subtitle ? (
            <p className="truncate text-xs text-muted-foreground">
              {card.subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {shown.length ? (
        <dl className="mt-2 grid gap-1">
          {shown.map((attribute) => (
            <div key={attribute.slug} className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {attribute.label}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-xs">
                {attribute.text}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <footer className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {card.owner ? (
            <>
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
              >
                {initials(card.owner)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {card.owner}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.actorType === "agent" || card.actorType === "automation" ? (
            <Badge variant="outline" className="font-normal">
              {t(`board.addedBy.${card.actorType}`)}
            </Badge>
          ) : null}
          <SlaBadge sla={sla} />
        </div>
      </footer>
    </article>
  );
}

function SlaBadge({ sla }: { sla: ReturnType<typeof boardCardSla> }) {
  const t = useT();
  if (sla.status === "not-tracked") return null;
  if (sla.status === "unknown") {
    return (
      <span
        className="text-muted-foreground/60"
        title={t(`board.sla.${sla.reason}`)}
      >
        <IconClock className="size-3.5" />
      </span>
    );
  }
  if (sla.status === "within") {
    return (
      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        <IconClock className="size-3.5" />
        {t("board.daysInStage", { days: sla.days })}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400"
      title={t("board.overrunDetail", {
        days: sla.days,
        overBy: sla.overBy,
        targetDays: sla.targetDays,
      })}
    >
      <IconClockExclamation className="size-3.5" />
      {t("board.overBy", { overBy: sla.overBy })}
    </span>
  );
}

function BoardTable({ columns, now }: { columns: BoardColumn[]; now: Date }) {
  const t = useT();
  const rows = columns.flatMap((column) =>
    column.cards.map((card) => ({ card, column })),
  );
  return (
    <div className="overflow-x-auto p-5 sm:p-7">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("board.table.record")}</TableHead>
            <TableHead>{t("board.table.stage")}</TableHead>
            <TableHead>{t("board.table.owner")}</TableHead>
            <TableHead className="text-right">
              {t("board.table.amount")}
            </TableHead>
            <TableHead className="text-right">
              {t("board.table.timeInStage")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ card, column }) => (
            <TableRow key={card.id}>
              <TableCell>
                <Link
                  to={`/records/${encodeURIComponent(card.recordId)}`}
                  className="font-medium hover:underline"
                >
                  {card.title}
                </Link>
                {card.subtitle ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {card.subtitle}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>{columnTitle(column, t)}</TableCell>
              <TableCell>{card.owner ?? EMPTY_CELL}</TableCell>
              <TableCell className="text-right tabular-nums">
                {card.amount === null
                  ? EMPTY_CELL
                  : formatMoney(card.amount, card.currencyCode)}
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex justify-end">
                  <SlaBadge sla={boardCardSla(card, column.option, now)} />
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const EMPTY_CELL = "—";

type Translate = ReturnType<typeof useT>;

function columnTitle(column: BoardColumn, t: Translate): string {
  if (column.kind === "unset") return t("board.column.unset");
  if (column.kind === "unknown") {
    return t("board.column.unknown", { value: column.key });
  }
  const title = column.option?.title ?? column.key;
  return column.kind === "archived"
    ? t("board.column.archived", { title })
    : title;
}

function formatValue(value: unknown, t: Translate): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") {
    return value ? t("board.value.yes") : t("board.value.no");
  }
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.flatMap((entry) => {
      const formatted = formatValue(entry, t);
      return formatted ? [formatted] : [];
    });
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function formatMoney(amount: number, currencyCode: string | null): string {
  if (!currencyCode) return amount.toLocaleString();
  try {
    return amount.toLocaleString(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    });
  } catch {
    // An unknown ISO code is a data problem, not a reason to hide the number.
    return `${amount.toLocaleString()} ${currencyCode}`;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
