import { useLocale } from "@agent-native/core/client/i18n";
import { IconActivity, IconFilterOff } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import {
  DEFAULT_ACTIVITY_FILTERS,
  activityQueryParams,
  dayBreaks,
  hasActivityFilters,
  rangeSince,
  type ActivityFilterState,
  type LinkAction,
} from "./activity/activity-model";
import { ActivityFilters } from "./activity/ActivityFilters";
import {
  ActivityRowView,
  ActivityRowsSkeleton,
  DayHeading,
} from "./activity/ActivityRow";
import { useItemsStrings } from "./items-strings";
import { formatDayLabel } from "./items/format";
import { ItemJourneySheet } from "./items/ItemJourneySheet";
import {
  ReadPages,
  useNow,
  useWorkflowOptions,
  useWorkflowReadSync,
} from "./items/read-support";
import type {
  ActivityPageData,
  ItemTarget,
  OpenWorkflow,
} from "./items/read-types";

interface ActivityViewProps {
  factoryId: string;
  /** `target` is optional: a page that only handles `(workflowId, nodeId?)` still fits. */
  onOpenWorkflow?: OpenWorkflow;
}

// A short page with more behind it is common (the feed merges runs and
// audited changes), so the next page opens on its own, but only this many in
// a row before the viewer has to ask.
const AUTO_PAGES = 4;

function countEntries(page: ActivityPageData): number {
  return page.entries.length;
}

export function ActivityView({ factoryId, onOpenWorkflow }: ActivityViewProps) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  useWorkflowReadSync();
  const nowMs = useNow();
  const [filters, setFilters] = useState<ActivityFilterState>(
    DEFAULT_ACTIVITY_FILTERS,
  );
  const [open, setOpen] = useState<ItemTarget | null>(null);
  const workflows = useWorkflowOptions(factoryId);

  // The window opens when the range is chosen, not on every render.
  const since = useMemo(
    () => rangeSince(filters.range, Date.now()),
    [filters.range],
  );
  const params = useMemo(
    () => activityQueryParams(factoryId, filters, since),
    [factoryId, filters, since],
  );

  const openLink = useCallback(
    (action: LinkAction) => {
      if (action.kind === "item") {
        setOpen({ workflowId: action.workflowId, itemId: action.itemId });
        return;
      }
      if (!onOpenWorkflow) return;
      if (action.kind === "run") {
        onOpenWorkflow(action.workflowId, undefined, { runId: action.runId });
        return;
      }
      onOpenWorkflow(
        action.workflowId,
        undefined,
        action.version === null ? undefined : { version: action.version },
      );
    },
    [onOpenWorkflow],
  );

  const renderPage = useCallback(
    (page: ActivityPageData, previousDay: string | undefined) => {
      const { breaks, lastDay } = dayBreaks(page.entries, previousDay);
      return {
        node: page.entries.map((entry) => {
          const heading = breaks.get(entry.id);
          return (
            <div key={entry.id} role="presentation">
              {heading ? (
                <DayHeading>
                  {formatDayLabel(heading.at, nowMs, s, locale)}
                </DayHeading>
              ) : null}
              <ActivityRowView entry={entry} onOpenLink={openLink} />
            </div>
          );
        }),
        carry: lastDay,
      };
    },
    [nowMs, openLink, s, locale],
  );

  const filtered = hasActivityFilters(filters);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <ActivityFilters
        filters={filters}
        workflows={workflows.options}
        workflowsLoading={workflows.isLoading}
        onChange={setFilters}
      />
      <div
        role="list"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <ReadPages<ActivityPageData, string>
          key={JSON.stringify(params)}
          action="list-factory-activity"
          params={params}
          countOf={countEntries}
          renderPage={renderPage}
          skeleton={<ActivityRowsSkeleton />}
          loadMoreLabel={s.activity.loadMore}
          autoLimit={AUTO_PAGES}
          empty={
            <Empty className="border-0 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {filtered ? <IconFilterOff /> : <IconActivity />}
                </EmptyMedia>
                <EmptyTitle>
                  {filtered ? s.activity.empty.filtered : s.activity.empty.all}
                </EmptyTitle>
              </EmptyHeader>
              {filtered ? (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilters(DEFAULT_ACTIVITY_FILTERS)}
                  >
                    {s.items.clearFilters}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          }
        />
      </div>
      <ItemJourneySheet
        factoryId={factoryId}
        target={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        onOpenWorkflow={onOpenWorkflow}
      />
    </div>
  );
}
