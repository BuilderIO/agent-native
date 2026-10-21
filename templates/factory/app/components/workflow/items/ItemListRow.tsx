import { useLocale } from "@agent-native/core/client/i18n";

import { SlackMrkdwn } from "@/components/factory/SlackMrkdwn";
import { Skeleton } from "@/components/ui/skeleton";

import { useItemsStrings } from "../items-strings";
import { lastEventText } from "./event-summary";
import { formatRelative } from "./format";
import {
  isSlackSource,
  itemPhase,
  needsYouText,
  sourceLabel,
  whereText,
} from "./item-status";
import { ItemStatusChip } from "./ItemStatusChip";
import type { ItemRow } from "./read-types";
import { SourceMark } from "./SourceMark";

const ROW_GRID =
  "grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5";

/** A title on one line (`wrap` false) or free to wrap, with Slack markup shown as it reads in Slack. */
export function ItemTitle({
  title,
  source,
  wrap = false,
}: {
  title: string | null;
  source: string | null;
  wrap?: boolean;
}) {
  const s = useItemsStrings();

  if (!title) return <>{s.items.untitled}</>;
  if (!isSlackSource(source)) return <>{title}</>;
  return wrap ? (
    <span className="[&>div]:text-base [&>div]:font-semibold [&>div]:leading-6">
      <SlackMrkdwn text={title} />
    </span>
  ) : (
    <SlackMrkdwn text={title} inline />
  );
}

export function ItemListRow({
  row,
  nowMs,
  onOpen,
}: {
  row: ItemRow;
  nowMs: number;
  onOpen: (row: ItemRow) => void;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  const phase = itemPhase(row, s);
  const reasons = needsYouText(row.needsYouReasons, s);
  const where = whereText(row, nowMs, s, locale);
  const last = row.lastEvent ? lastEventText(row.lastEvent) : null;
  const source = sourceLabel(row.source, s);
  const secondary = [
    source,
    row.workflowName,
    where ?? (last ? null : s.where.notStarted),
    last,
  ].filter((part): part is string => Boolean(part));
  return (
    <div role="listitem" className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={`${ROW_GRID} px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring`}
      >
        <SourceMark source={row.source} className="mt-0.5" />
        <span className="min-w-0 space-y-0.5">
          <span className="block truncate text-sm font-medium text-foreground">
            <ItemTitle title={row.title} source={row.source} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {reasons ? (
              <span className="font-medium text-destructive">{reasons}</span>
            ) : null}
            {reasons && secondary.length > 0 ? " · " : null}
            {secondary.join(" · ")}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <ItemStatusChip phase={phase} />
          <time
            dateTime={row.lastActivityAt}
            className="text-xs tabular-nums text-muted-foreground"
          >
            {formatRelative(row.lastActivityAt, nowMs, locale)}
          </time>
        </span>
      </button>
    </div>
  );
}

function ItemRowSkeleton() {
  return (
    <div
      className={`${ROW_GRID} border-b border-border px-3 py-2.5 last:border-b-0`}
      aria-hidden
    >
      <Skeleton className="mt-0.5 size-4" />
      <span className="min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </span>
      <span className="flex flex-col items-end gap-1.5">
        <Skeleton className="h-[1.375rem] w-20 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </span>
    </div>
  );
}

export function ItemRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <ItemRowSkeleton key={index} />
      ))}
    </>
  );
}
