import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconHourglass,
  IconLock,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { useItemsStrings, type ItemsStrings } from "../../items-strings";
import { formatRelative, formatUntil } from "../format";
import { needsYouText } from "../item-status";
import type { ItemJourneyData, ItemParking } from "../read-types";

type JourneyState = NonNullable<ItemJourneyData["state"]>;

function watching(
  thread: NonNullable<ItemParking["watching"]>,
  s: ItemsStrings,
): string | null {
  if (thread.channelId) return s.journey.parked.slackThread(thread.channelId);
  if (thread.number !== undefined) {
    return s.journey.parked.pullRequest(thread.repo, thread.number);
  }
  if (thread.ticketId) return s.journey.parked.ticket(thread.ticketId);
  return null;
}

/** A check time that has passed reads "due", not "again 11 sec. ago". */
function nextCheckText(
  nextCheckAt: string,
  nowMs: number,
  s: ItemsStrings,
  locale: string,
): string {
  const at = Date.parse(nextCheckAt);
  if (Number.isFinite(at) && at <= nowMs) return s.journey.parked.checkDue;
  return s.journey.parked.nextCheck(
    formatRelative(nextCheckAt, nowMs, locale) ?? nextCheckAt,
  );
}

function Row({
  icon,
  tone = "default",
  children,
}: {
  icon: ReactNode;
  tone?: "default" | "attention";
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        className={
          tone === "attention"
            ? "mt-0.5 text-destructive"
            : "mt-0.5 text-muted-foreground"
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * Where the item stands right now: parked and for what, who holds it, and why
 * a person has to look. Renders nothing for an item that is simply moving.
 */
export function JourneyState({
  state,
  inbox,
  nowMs,
}: {
  state: JourneyState | null;
  inbox: boolean;
  nowMs: number;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  if (!state) return null;
  const { parked, lease, needsYouReasons, attempts } = state;
  const reasons = needsYouText(needsYouReasons, s);
  const rows: ReactNode[] = [];

  if (reasons) {
    rows.push(
      <Row
        key="needs"
        tone="attention"
        icon={<IconAlertTriangle className="size-4" aria-hidden />}
      >
        <p className="text-sm font-medium text-destructive">{reasons}</p>
        {attempts > 0 ? (
          <p className="text-xs text-muted-foreground">
            {s.journey.attempts(attempts)}
          </p>
        ) : null}
      </Row>,
    );
  }

  if (parked) {
    const node = parked.nodeMissingFromGraph
      ? s.where.nodeRemoved
      : (parked.nodeName ?? parked.nodeId);
    const heading =
      parked.wait === "reply"
        ? s.journey.parked.reply(node)
        : parked.wait === "time"
          ? s.journey.parked.time(node)
          : s.journey.parked.condition(node);
    const thread = parked.watching ? watching(parked.watching, s) : null;
    rows.push(
      <Row key="parked" icon={<IconHourglass className="size-4" aria-hidden />}>
        <p className="text-sm font-medium">{heading}</p>
        <p className="text-xs text-muted-foreground">
          {s.journey.parked.due(formatUntil(parked.dueAt, nowMs, locale))}
          {parked.nextCheckAt
            ? ` \u00b7 ${nextCheckText(parked.nextCheckAt, nowMs, s, locale)}`
            : ""}
        </p>
        {thread ? (
          <p className="text-xs text-muted-foreground">
            {s.journey.parked.watching}: {thread}
          </p>
        ) : null}
      </Row>,
    );
  }

  if (lease) {
    rows.push(
      <Row key="lease" icon={<IconLock className="size-4" aria-hidden />}>
        <p className="text-xs text-muted-foreground">
          {lease.live
            ? s.journey.lease.held(
                lease.by,
                formatUntil(lease.until, nowMs, locale),
              )
            : s.journey.lease.expired(lease.by)}
        </p>
      </Row>,
    );
  }

  if (!inbox) {
    rows.push(
      <Row key="synthetic" icon={null}>
        <p className="text-xs text-muted-foreground">
          {s.journey.syntheticNote}
        </p>
      </Row>,
    );
  }

  if (rows.length === 0) return null;
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {rows}
    </div>
  );
}
