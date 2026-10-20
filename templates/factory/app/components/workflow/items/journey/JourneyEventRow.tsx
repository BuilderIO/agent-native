import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconArrowRight,
  IconArrowsSplit2,
  IconBellRinging,
  IconFlagCheck,
  IconHourglass,
  IconInbox,
  IconListDetails,
  IconSend,
  type Icon,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useItemsStrings, type ItemsStrings } from "../../items-strings";
import { endedDetail, errorDetail } from "../event-summary";
import { formatClock } from "../format";
import { PARKED_PORT, type PortLabeler } from "../port-label";
import type { ItemEventKind, JourneyEvent, ReceiptView } from "../read-types";
import { ReceiptLink } from "./ReceiptLink";

const EVENT_ICONS: Record<ItemEventKind, Icon> = {
  taken: IconInbox,
  entered: IconArrowRight,
  output: IconListDetails,
  decision: IconArrowsSplit2,
  effect: IconSend,
  parked: IconHourglass,
  woke: IconBellRinging,
  ended: IconFlagCheck,
  error: IconAlertCircle,
};

// More than this many characters or lines is folded behind "Show more".
const FOLD_CHARS = 180;
const FOLD_LINES = 3;

function needsFold(text: string): boolean {
  return text.length > FOLD_CHARS || text.split("\n").length > FOLD_LINES;
}

function titleFor(event: JourneyEvent, s: ItemsStrings): string {
  const node = event.nodeName ?? event.nodeId;
  switch (event.kind) {
    case "taken":
      return s.journey.event.taken(node);
    case "entered":
      return s.journey.event.entered(node);
    case "output":
      return s.journey.event.output(node);
    case "decision":
      return s.journey.event.decision(node);
    case "effect":
      return s.journey.event.effect(node);
    case "parked":
      return s.journey.event.parked(node);
    case "woke":
      return s.journey.event.woke(node);
    case "error":
      return s.journey.event.error(node);
    case "ended":
      return event.outcome
        ? s.journey.event.ended(
            s.journey.outcome[event.outcome] ?? event.outcome,
          )
        : s.journey.event.endedPlain;
  }
}

// `out` is the one port a step has when it does not branch: nothing was chosen,
// so there is nothing to say. Any other port reads as the canvas names it.
function portText(event: JourneyEvent, portLabel: PortLabeler): string | null {
  if (!event.port || event.port === "out" || event.port === PARKED_PORT) {
    return null;
  }
  return event.nodeId ? portLabel(event.nodeId, event.port) : event.port;
}

function Body({ event }: { event: JourneyEvent }) {
  const s = useItemsStrings();

  const [expanded, setExpanded] = useState(false);
  if (event.kind === "error") {
    return (
      <div className="space-y-0.5">
        {event.code ? (
          <p className="font-mono text-xs font-medium text-destructive">
            {event.code}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-xs text-foreground">
          {errorDetail(event.summary, event.code)}
        </p>
      </div>
    );
  }
  // The title says how an end ended; the body is what the engine added.
  const text =
    event.kind === "ended" && event.outcome
      ? (endedDetail(event.summary, event.outcome) ?? "")
      : event.summary.trim();
  if (!text) return null;
  const fold = needsFold(text);
  return (
    <div className="space-y-1">
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-xs text-muted-foreground",
          fold && !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {fold ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto p-0 text-xs"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? s.journey.showLess : s.journey.showMore}
        </Button>
      ) : null}
      {event.summaryTruncated ? (
        <p className="text-xs text-muted-foreground">
          {s.journey.summaryTruncated}
        </p>
      ) : null}
    </div>
  );
}

export function JourneyEventRow({
  event,
  receipt,
  selected,
  last,
  portLabel,
  onSelectNode,
}: {
  event: JourneyEvent;
  receipt: ReceiptView | undefined;
  selected: boolean;
  last: boolean;
  portLabel: PortLabeler;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  const port = portText(event, portLabel);
  const KindIcon = EVENT_ICONS[event.kind];
  const failed = event.kind === "error";
  const selectable = event.nodeId !== null;
  return (
    <li
      data-node-id={event.nodeId ?? undefined}
      data-selected={selected || undefined}
      className={cn(
        "relative flex gap-3 rounded-md pb-4 pe-2 ps-1",
        selected && "bg-muted/60",
        !last &&
          "before:absolute before:start-[1.0625rem] before:top-7 before:bottom-0 before:w-px before:bg-border",
      )}
    >
      <span
        className={cn(
          "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          failed
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <KindIcon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-3">
          {selectable ? (
            <button
              type="button"
              className="min-w-0 text-start text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:underline"
              aria-pressed={selected}
              onClick={() => onSelectNode(selected ? null : event.nodeId)}
            >
              {titleFor(event, s)}
            </button>
          ) : (
            <p className="min-w-0 text-sm font-medium text-foreground">
              {titleFor(event, s)}
            </p>
          )}
          <time
            dateTime={event.at}
            className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
          >
            {formatClock(event.at, locale)}
          </time>
        </div>
        {port ? (
          <p className="text-xs text-muted-foreground">
            {s.journey.event.port(port)}
          </p>
        ) : null}
        <Body event={event} />
        {receipt ? (
          receipt.externalRef || receipt.url ? (
            <ReceiptLink receipt={receipt} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {s.journey.receiptState[receipt.status]}
            </p>
          )
        ) : null}
      </div>
    </li>
  );
}
