import { useLocale } from "@agent-native/core/client/i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useItemsStrings, type ItemsStrings } from "../items-strings";
import { formatClock } from "../items/format";
import type { ChipTone } from "../items/item-status";
import type { ActivityEntry } from "../items/read-types";
import {
  actorLabel,
  describeRunCounts,
  linkAction,
  runStatusView,
  type LinkAction,
} from "./activity-model";

const TONE_STYLES: Record<ChipTone, string> = {
  attention: "bg-destructive/10 text-destructive",
  waiting: "bg-muted text-foreground",
  neutral: "bg-muted text-muted-foreground",
};

function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium leading-4",
        TONE_STYLES[tone],
      )}
    >
      {children}
    </span>
  );
}

interface EntryView {
  kindLabel: string;
  kindTone: ChipTone;
  text: string;
  detail: string | null;
  detailTone: "muted" | "error";
  status: { label: string; tone: ChipTone };
  mode: "live" | "dry" | "test";
}

function describe(entry: ActivityEntry, s: ItemsStrings): EntryView {
  switch (entry.kind) {
    case "run": {
      const status = runStatusView(entry.status, s);
      return {
        kindLabel: s.activity.kindChip.run,
        kindTone: "neutral",
        text: describeRunCounts(entry.counts, s),
        detail: entry.error
          ? `${entry.error.code}: ${entry.error.message}`
          : null,
        detailTone: "error",
        status,
        mode: entry.mode,
      };
    }
    case "change": {
      const text =
        entry.change === "saved"
          ? s.activity.changeText.saved(entry.version)
          : entry.change === "restored"
            ? s.activity.changeText.restored(entry.version)
            : s.activity.changeText[entry.change];
      return {
        kindLabel: s.activity.kindChip.change,
        kindTone: "neutral",
        text,
        // The audit line names ids the chip and text already say; it is shown
        // only for a change this build has no wording for.
        detail: entry.change === "other" ? entry.summary : null,
        detailTone: "muted",
        status: { label: s.activity.change[entry.change], tone: "neutral" },
        mode: "live",
      };
    }
    case "needs_you":
      return {
        kindLabel: s.activity.kindChip.needs_you,
        kindTone: "attention",
        text: s.activity.handedOff(entry.item.title ?? s.items.untitled),
        detail: entry.reason,
        detailTone: "muted",
        status: { label: s.activity.kindChip.needs_you, tone: "attention" },
        mode: "live",
      };
  }
}

export function ActivityRowView({
  entry,
  onOpenLink,
}: {
  entry: ActivityEntry;
  onOpenLink: (action: LinkAction) => void;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  const view = describe(entry, s);
  const link = linkAction(entry, s);
  const failedRun = entry.kind === "run" && entry.status === "failed";
  return (
    <div
      role="listitem"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0",
        failedRun && "bg-destructive/[0.03]",
      )}
    >
      <time
        dateTime={entry.at}
        className="w-[4.25rem] shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
      >
        {formatClock(entry.at, locale)}
      </time>
      <span className="flex w-[4.75rem] shrink-0">
        <Chip tone={view.kindTone}>{view.kindLabel}</Chip>
      </span>
      <span className="flex w-24 shrink-0">
        <Badge variant="outline" className="max-w-full font-normal">
          <span className="truncate">{actorLabel(entry.actor, s)}</span>
        </Badge>
      </span>
      <div className="min-w-0 flex-1 basis-60 space-y-0.5">
        <p className="break-words text-sm">
          <span className="font-medium">
            {entry.workflowName ?? s.activity.unknownWorkflow}
          </span>
          <span className="text-muted-foreground">
            {" · "}
            {view.text}
          </span>
        </p>
        {view.detail ? (
          <p
            className={cn(
              "line-clamp-2 break-words text-xs",
              view.detailTone === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {view.detail}
          </p>
        ) : null}
      </div>
      {view.mode !== "live" ? (
        <Badge variant="outline" className="shrink-0 font-normal">
          {s.mode[view.mode]}
        </Badge>
      ) : null}
      <span className="flex w-20 shrink-0 justify-end">
        <Chip tone={view.status.tone}>{view.status.label}</Chip>
      </span>
      <span className="flex w-28 shrink-0 justify-end">
        {link ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenLink(link)}>
            {link.label}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

export function DayHeading({ children }: { children: string }) {
  return (
    <div
      role="presentation"
      className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground"
    >
      {children}
    </div>
  );
}

export function ActivityRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex items-center gap-x-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-3 w-11" />
          <Skeleton className="h-[1.375rem] w-14 rounded-full" />
          <Skeleton className="h-[1.375rem] w-16 rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-[1.375rem] w-14 rounded-full" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </>
  );
}
