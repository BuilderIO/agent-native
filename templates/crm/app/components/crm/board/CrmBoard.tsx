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
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconClock,
  IconClockExclamation,
} from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";

import type { CrmAttributeType } from "../../../../shared/crm-attributes";
import { ProvenanceMarker } from "../grid/GridCell";
import type { CrmCellProvenance } from "../grid/model";
import { AttributeTypeIcon } from "../record/attribute-row";
import {
  currencyCodeOf,
  formatAttributeValue,
  valueTokens,
  type CrmAttributeValue,
  type CrmValueShape,
} from "../shared/attribute-value";
import {
  AttributeOptionChip,
  AttributeRating,
} from "../shared/AttributeValueParts";
import { MOTION, overlayProps } from "../shared/ui-tokens";
import {
  BOARD_UNGROUPED,
  boardCardSla,
  boardColumns,
  boardColumnTotals,
  boardOverruns,
  cardAmountFor,
  moveBoardCard,
  moveValueForColumn,
  objectBoardMoveArgs,
  pickCardAttributes,
  pickCurrencyAttribute,
  type BoardActorType,
  type BoardCard,
  type BoardCardAttribute,
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
    remoteRevision: string | null;
  }>;
  complete: boolean;
}

const PAGE_LIMIT = 100;

/**
 * Time in stage, compactly: "3d", "14d", "+5d". `Intl` owns the unit, so a
 * locale that does not abbreviate days still reads correctly (ar-SA renders
 * "١٤ ي") without a per-locale string of our own. The long sentence stays as
 * the row's `title`.
 */
const DAY_UNIT: Intl.NumberFormatOptions = {
  style: "unit",
  unit: "day",
  unitDisplay: "narrow",
};

/**
 * Drop confirmation: the accent tint lands instantly on the card that just
 * committed, then eases back to rest. Board-local rather than a shared motion
 * token — nothing else in the app confirms a drop, and 900ms is far outside
 * the interaction scale the other surfaces share.
 *
 * It REPLACES the resting `bg-card` rather than being layered on top of it.
 * Two `bg-*` utilities on one element are decided by their order in the
 * generated stylesheet, not by the order they are written, and the theme
 * colour wins — so a flash appended to the class list silently paints nothing.
 */
const CARD_REST_CLASS = "bg-card";
const DROP_FLASH_CLASS = "bg-[hsl(var(--crm-accent)/0.12)] transition-none";

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
  const shown = pickCardAttributes(
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
        // An entry move writes the entry, not the record.
        remoteRevision: null,
        groupValue: typeof raw === "string" && raw ? raw : BOARD_UNGROUPED,
        groupSince: entry.valuesSince[groupSlug] ?? null,
        // Only a typed currency attribute counts here, never the legacy
        // mirrored `crmRecords.amount` column: that field predates the
        // attribute system and is not what a view's own columns name.
        amount: cardAmountFor(currencyAttribute, entry.values),
        currencyCode: currencyAttribute
          ? currencyCodeOf(currencyAttribute.config)
          : null,
        attributes: shown.map((attribute) => ({
          slug: attribute.apiSlug,
          label: attribute.label,
          attributeType: attribute.attributeType,
          multi: attribute.multi,
          options: toBoardOptions(attribute),
          config: attribute.config,
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
          remoteRevision: record.remoteRevision,
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
        objectBoardMoveArgs(card, groupSlug, toValue) as never,
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

  // The confirmed card's id, held only long enough for the tint to land. It is
  // set after the commit resolves, never on the optimistic paint: the flash
  // means "this move is saved", so a move that later rolls back never flashes.
  const [flashCardId, setFlashCardId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashCardId) return;
    const timer = setTimeout(() => setFlashCardId(null), MOTION.fast);
    return () => clearTimeout(timer);
  }, [flashCardId]);

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
    if (result.moved) {
      setFlashCardId(cardId);
      data.refetch();
    }
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
        <span className="text-xs text-content-tertiary">
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
          <span className="text-xs text-content-tertiary">
            {t("board.partialPage", { limit: PAGE_LIMIT })}
          </span>
        )}
      </div>
      {props.mode === "table" ? (
        <BoardTable columns={columns} now={now} />
      ) : (
        <div className="flex gap-4 overflow-x-auto p-5 sm:p-7">
          {columns.map((column, index) => (
            <BoardColumnView
              key={column.key}
              column={column}
              now={now}
              flashCardId={flashCardId}
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
    <div className="m-5 flex flex-wrap items-center gap-3 rounded-card border border-hairline bg-card p-4 sm:m-7">
      <IconAlertTriangle className="size-4 text-content-tertiary" />
      <p className="text-sm text-content-secondary">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("board.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A column is 300px of nothing: no trough, no border, the page background. The
 * cards carry the only boundary on the board, which is what keeps a wide
 * pipeline from reading as a row of grey boxes. Its one visual state is
 * drag-over, and that rides the shared overlay so it cross-fades rather than
 * swapping a background.
 */
function BoardColumnView({
  column,
  now,
  flashCardId,
  onDropCard,
  onMoveCard,
}: {
  column: BoardColumn;
  now: Date;
  flashCardId: string | null;
  onDropCard: (cardId: string) => void;
  onMoveCard: (cardId: string, offset: -1 | 1) => void;
}) {
  const t = useT();
  const [isOver, setIsOver] = useState(false);
  const totals = boardColumnTotals(column.cards);

  return (
    <section
      {...overlayProps({
        selected: isOver,
        className: "flex w-75 shrink-0 flex-col rounded-column",
      })}
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        // dragleave also fires crossing into a child, which would strobe the
        // drop tint over every card the cursor passes.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setIsOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        const cardId = event.dataTransfer.getData("text/plain");
        if (cardId) onDropCard(cardId);
      }}
    >
      {/* Dot, name, count read as one cluster. Pushing the count to the column's
          far edge turns an invisible column into an implied box the whole point
          of dropping the trough was to remove. */}
      <header className="flex h-9 shrink-0 items-center gap-2">
        <StageDot color={column.option?.color} />
        <p className="min-w-0 truncate text-sm font-semibold">
          {columnTitle(column, t)}
        </p>
        <span className="shrink-0 rounded-badge bg-muted px-1.5 py-0.5 text-xs tabular-nums text-content-secondary">
          {totals.count}
        </span>
      </header>
      <ColumnTotals totals={totals} />
      {/* The 8px fade is exactly the list's own top padding, so it is invisible
          at rest and only bites once a card scrolls under the header. */}
      <div className="flex max-h-[70svh] min-h-24 flex-col gap-2 overflow-y-auto pt-2 [mask-image:linear-gradient(to_bottom,transparent,black_8px)]">
        {column.cards.map((card) => (
          <BoardCardView
            key={card.id}
            card={card}
            option={column.option}
            columnLabel={columnTitle(column, t)}
            now={now}
            flash={card.id === flashCardId}
            onMove={(offset) => onMoveCard(card.id, offset)}
          />
        ))}
        {column.cards.length ? null : (
          <p className="py-3 text-xs text-content-tertiary">
            {t("board.columnEmpty")}
          </p>
        )}
      </div>
    </section>
  );
}

/** The stage's own colour, and the board's only decorative motion. */
function StageDot({ color }: { color?: string | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full transition-transform hover:scale-120",
        color ? null : "ring-1 ring-inset ring-hairline",
      )}
      {...(color ? { style: { backgroundColor: color } } : {})}
    />
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
      <p className="text-xs text-content-tertiary">
        {t("board.mixedCurrency")}
      </p>
    );
  }
  // No summable amount means no total line at all. A "0" here would read as a
  // real, empty pipeline stage.
  if (totals.sum === null) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-content-tertiary">
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
  flash,
  onMove,
}: {
  card: BoardCard;
  option: BoardOption | null;
  columnLabel: string;
  now: Date;
  flash: boolean;
  onMove: (offset: -1 | 1) => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const sla = boardCardSla(card, option, now);
  const shown = card.attributes.flatMap((attribute) => {
    const node = cardAttributeNode(attribute, t);
    return node === null
      ? []
      : [
          {
            slug: attribute.slug,
            label: attribute.label,
            attributeType: attribute.attributeType,
            node,
          },
        ];
  });
  // The record/entry has no per-field provenance at this data layer, only who
  // created it — so this is coarser than the grid's per-cell marker, but the
  // same "quiet unless non-human" idiom applies.
  const provenance: CrmCellProvenance | undefined = card.actorType
    ? { actorType: card.actorType, readable: true }
    : undefined;

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
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onKeyDown={(event) => {
        // Keyboard parity with the drag: a card can be moved without a mouse.
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onMove(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      {...overlayProps({
        className: cn(
          "group flex cursor-grab flex-col gap-1.5 rounded-lg border border-hairline p-3 outline-none transition-[background-color] duration-[900ms] ease-drop focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
          dragging && "shadow-e2",
          flash ? DROP_FLASH_CLASS : CARD_REST_CLASS,
        ),
      })}
    >
      {/* A zero-size anchor: `ProvenanceMarker`'s own wedge is absolutely
          positioned at its containing block's bottom-right corner, so this is
          what moves it to the card's top-right instead of the SLA badge's
          corner in the footer. */}
      <span className="absolute right-1.5 top-1.5 size-0">
        <ProvenanceMarker provenance={provenance} attributeLabel={card.title} />
      </span>
      {/* 16px avatar + 8px gap and the 20px type-icon box + 4px gap below both
          come to a 24px gutter, so the title, the subtitle and every value
          share one left edge. */}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium text-content-secondary ring-1 ring-inset ring-hairline"
        >
          {initials(card.title).slice(0, 1)}
        </span>
        <Link
          to={`/records/${encodeURIComponent(card.recordId)}`}
          className="min-w-0 flex-1 truncate text-sm font-medium underline decoration-content-ghost underline-offset-2 hover:decoration-current"
        >
          {card.title}
        </Link>
      </div>
      {card.subtitle ? (
        <p className="flex items-center gap-1 text-xs text-content-tertiary">
          <span aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{card.subtitle}</span>
        </p>
      ) : null}
      {/* One row per value, each led by its attribute type's glyph in a fixed
          gutter. The glyph is what carries the label, so the name itself is
          only announced, not printed — a 300px card has no room for both. */}
      {card.amount !== null || shown.length ? (
        <dl className="flex flex-col gap-1.5">
          {card.amount !== null ? (
            <div className="flex items-center gap-1">
              <AttributeTypeIcon type="currency" />
              <dt className="sr-only">{t("board.table.amount")}</dt>
              <dd className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
                {formatMoney(card.amount, card.currencyCode)}
              </dd>
            </div>
          ) : null}
          {shown.map((attribute) => (
            <div
              key={attribute.slug}
              className="flex items-center gap-1"
              title={attribute.label}
            >
              <AttributeTypeIcon
                type={attribute.attributeType as CrmAttributeType}
              />
              <dt className="sr-only">{attribute.label}</dt>
              <dd className="min-w-0 flex-1 truncate text-sm">
                {attribute.node}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <footer className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {card.owner ? (
            <>
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium text-content-secondary ring-1 ring-inset ring-hairline"
              >
                {initials(card.owner)}
              </span>
              <span className="truncate text-xs text-content-secondary">
                {card.owner}
              </span>
            </>
          ) : null}
        </div>
        <SlaBadge sla={sla} />
      </footer>
    </article>
  );
}

/**
 * One card row's value, through the same per-type registry the grid and
 * record panel use — never a second ad hoc formatter. `null` means the value
 * is genuinely empty, so the row is omitted instead of showing a blank dash.
 */
function cardAttributeNode(
  attribute: BoardCardAttribute,
  t: Translate,
): ReactNode | null {
  // `BoardCardAttribute.attributeType` stays a plain string so board-model.ts
  // does not have to import the app's attribute-type union; the registry
  // itself is the source of truth for which strings are valid.
  const shape = attribute as unknown as CrmValueShape;
  const value = attribute.value as CrmAttributeValue;
  if (attribute.attributeType === "rating") {
    return typeof value === "number" ? <AttributeRating value={value} /> : null;
  }
  if (
    attribute.attributeType === "status" ||
    attribute.attributeType === "select"
  ) {
    const tokens = valueTokens(shape, value);
    if (!tokens.length) return null;
    return (
      <span className="flex flex-wrap items-center gap-1">
        {tokens.map((token, index) => (
          <AttributeOptionChip key={`${token.label}:${index}`} token={token} />
        ))}
      </span>
    );
  }
  if (attribute.attributeType === "checkbox") {
    if (value !== true && value !== false) return null;
    return value ? t("board.value.yes") : t("board.value.no");
  }
  const text = formatAttributeValue(shape, value);
  return text || null;
}

/**
 * Time in stage, in the card footer's right slot. The compact form is what
 * fits; the full sentence stays reachable as the title, so "14d" never has to
 * carry the whole meaning on its own.
 */
function SlaBadge({ sla }: { sla: ReturnType<typeof boardCardSla> }) {
  const t = useT();
  const { formatNumber } = useFormatters();
  if (sla.status === "not-tracked") return null;
  if (sla.status === "unknown") {
    return (
      <span className="text-content-ghost" title={t(`board.sla.${sla.reason}`)}>
        <IconClock className="size-3.5" />
      </span>
    );
  }
  if (sla.status === "within") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-content-tertiary"
        title={t("board.daysInStage", { days: sla.days })}
      >
        <IconClock className="size-3.5" />
        {formatNumber(sla.days, DAY_UNIT)}
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400"
      title={t("board.overrunDetail", {
        days: sla.days,
        overBy: sla.overBy,
        targetDays: sla.targetDays,
      })}
    >
      <IconClockExclamation className="size-3.5" />
      {formatNumber(sla.overBy, { ...DAY_UNIT, signDisplay: "always" })}
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

/** Delegates to the one currency formatter in the shared registry. */
function formatMoney(amount: number, currencyCode: string | null): string {
  return formatAttributeValue(
    {
      attributeType: "currency",
      multi: false,
      ...(currencyCode ? { config: { currency: { code: currencyCode } } } : {}),
    },
    amount,
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
