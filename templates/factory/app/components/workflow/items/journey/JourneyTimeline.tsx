import { useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { useItemsStrings } from "../../items-strings";
import { formatDateTime } from "../format";
import type { PortLabeler } from "../port-label";
import { classifyReadError } from "../read-failure";
import { ReadErrorState } from "../read-support";
import type { ItemJourneyData, ReceiptView } from "../read-types";
import {
  groupEventsByRun,
  receiptsByKey,
  type RunGroup,
} from "./journey-model";
import { JourneyEventRow } from "./JourneyEventRow";

interface TimelineShared {
  factoryId: string;
  workflowId: string;
  itemId: string;
  receipts: ReadonlyMap<string, ReceiptView>;
  portLabel: PortLabeler;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onOpenRun?: (runId: string) => void;
}

export function TimelineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3 ps-1">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

function RunGroups({
  groups,
  shared,
}: {
  groups: RunGroup[];
  shared: TimelineShared;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  return (
    <>
      {groups.map((group) => (
        <div key={`${group.runId}:${group.events[0]?.id}`} className="pb-1">
          <div className="flex items-center gap-2 pb-2 ps-1 text-xs font-medium text-muted-foreground">
            <span>
              {s.journey.run(formatDateTime(group.startedAt, locale))}
            </span>
            {group.mode !== "live" ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[0.6875rem]">
                {s.mode[group.mode]}
              </Badge>
            ) : null}
            {shared.onOpenRun ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs"
                onClick={() => shared.onOpenRun?.(group.runId)}
              >
                {s.journey.openRun}
              </Button>
            ) : null}
          </div>
          <ol>
            {group.events.map((event, index) => (
              <JourneyEventRow
                key={event.id}
                event={event}
                receipt={
                  event.receiptKey
                    ? shared.receipts.get(event.receiptKey)
                    : undefined
                }
                selected={
                  shared.selectedNodeId !== null &&
                  event.nodeId === shared.selectedNodeId
                }
                last={index === group.events.length - 1}
                portLabel={shared.portLabel}
                onSelectNode={shared.onSelectNode}
              />
            ))}
          </ol>
        </div>
      ))}
    </>
  );
}

function OlderEvents({
  cursor,
  shared,
}: {
  cursor: string | null;
  shared: TimelineShared;
}) {
  const s = useItemsStrings();

  const [open, setOpen] = useState(false);
  if (cursor === null) return null;
  if (!open) {
    return (
      <div className="pb-3">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {s.journey.loadOlder}
        </Button>
      </div>
    );
  }
  return <OlderPage cursor={cursor} shared={shared} />;
}

function OlderPage({
  cursor,
  shared,
}: {
  cursor: string;
  shared: TimelineShared;
}) {
  const query = useActionQuery<ItemJourneyData>("get-item-journey", {
    factoryId: shared.factoryId,
    workflowId: shared.workflowId,
    itemId: shared.itemId,
    limit: 100,
    cursor,
  });
  if (!query.data) {
    return query.isError ? (
      <ReadErrorState
        failure={classifyReadError(query.error)}
        action="get-item-journey"
        onRetry={() => void query.refetch()}
        className="mb-3"
      />
    ) : (
      <div className="pb-4">
        <TimelineSkeleton rows={3} />
      </div>
    );
  }
  return (
    <>
      <OlderEvents cursor={query.data.olderCursor} shared={shared} />
      <RunGroups groups={groupEventsByRun(query.data.events)} shared={shared} />
    </>
  );
}

export function JourneyTimeline({
  factoryId,
  journey,
  portLabel,
  selectedNodeId,
  onSelectNode,
  onOpenRun,
}: {
  factoryId: string;
  journey: ItemJourneyData;
  portLabel: PortLabeler;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const s = useItemsStrings();

  const shared: TimelineShared = {
    factoryId,
    workflowId: journey.workflow.id,
    itemId: journey.item.id,
    receipts: receiptsByKey(journey.receipts),
    portLabel,
    selectedNodeId,
    onSelectNode,
    onOpenRun,
  };
  return (
    <section aria-labelledby="journey-timeline" className="space-y-3">
      <h3 id="journey-timeline" className="text-sm font-semibold">
        {s.journey.timelineHeading}
      </h3>
      {journey.events.length === 0 && journey.olderCursor === null ? (
        <p className="text-sm text-muted-foreground">{s.journey.noEvents}</p>
      ) : (
        <div>
          <OlderEvents cursor={journey.olderCursor} shared={shared} />
          <RunGroups
            groups={groupEventsByRun(journey.events)}
            shared={shared}
          />
        </div>
      )}
    </section>
  );
}
