import {
  IconCircleCheck,
  IconCircleOff,
  IconFilterOff,
  IconHourglass,
  IconInbox,
  type Icon,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { useItemsStrings } from "./items-strings";
import { ItemJourneySheet } from "./items/ItemJourneySheet";
import { ItemListRow, ItemRowsSkeleton } from "./items/ItemListRow";
import {
  DEFAULT_ITEMS_FILTERS,
  clearNarrowingFilters,
  hasNarrowingFilters,
  itemsQueryParams,
  type ItemsFilterState,
  type ItemsScope,
} from "./items/items-query";
import { ItemsFilters } from "./items/ItemsFilters";
import {
  ReadPages,
  useNow,
  useWorkflowOptions,
  useWorkflowReadSync,
} from "./items/read-support";
import type {
  ItemRow,
  ItemTarget,
  OpenWorkflow,
  ReadPage,
} from "./items/read-types";

interface ItemsViewProps {
  factoryId: string;
  /** `target` is optional: a page that only handles `(workflowId, nodeId?)` still fits. */
  onOpenWorkflow?: OpenWorkflow;
}

const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_ICONS: Record<ItemsScope, Icon> = {
  needs_you: IconCircleCheck,
  parked: IconHourglass,
  dismissed: IconCircleOff,
  all: IconInbox,
};

function countItems(page: ReadPage<ItemRow>): number {
  return page.items.length;
}

export function ItemsView({ factoryId, onOpenWorkflow }: ItemsViewProps) {
  const s = useItemsStrings();
  const emptyTitles: Record<ItemsScope, string> = {
    needs_you: s.items.empty.needsYou,
    parked: s.items.empty.parked,
    dismissed: s.items.empty.dismissed,
    all: s.items.empty.all,
  };

  useWorkflowReadSync();
  const nowMs = useNow();
  const [filters, setFilters] = useState<ItemsFilterState>(
    DEFAULT_ITEMS_FILTERS,
  );
  const [searchInput, setSearchInput] = useState("");
  const [open, setOpen] = useState<ItemTarget | null>(null);
  const workflows = useWorkflowOptions(factoryId);

  useEffect(() => {
    const id = window.setTimeout(
      () =>
        setFilters((current) =>
          current.search === searchInput
            ? current
            : { ...current, search: searchInput },
        ),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const params = useMemo(
    () => itemsQueryParams(factoryId, filters),
    [factoryId, filters],
  );

  const openRow = useCallback(
    (row: ItemRow) =>
      setOpen({
        workflowId: row.workflowId,
        itemId: row.itemId,
        title: row.title,
      }),
    [],
  );

  const renderPage = useCallback(
    (page: ReadPage<ItemRow>) => ({
      node: page.items.map((row) => (
        <ItemListRow
          key={`${row.workflowId}:${row.itemId}`}
          row={row}
          nowMs={nowMs}
          onOpen={openRow}
        />
      )),
      carry: undefined,
    }),
    [nowMs, openRow],
  );

  const narrowed = hasNarrowingFilters(filters);
  const EmptyIcon = narrowed ? IconFilterOff : EMPTY_ICONS[filters.scope];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <ItemsFilters
        filters={filters}
        searchInput={searchInput}
        workflows={workflows.options}
        workflowsLoading={workflows.isLoading}
        onScope={(scope) => setFilters((current) => ({ ...current, scope }))}
        onWorkflow={(workflowId) =>
          setFilters((current) => ({ ...current, workflowId }))
        }
        onSource={(source) => setFilters((current) => ({ ...current, source }))}
        onSearchInput={setSearchInput}
      />
      <div
        role="list"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <ReadPages<ReadPage<ItemRow>>
          // A new filter is a new list: pages already open belong to the old one.
          key={JSON.stringify(params)}
          action="list-workflow-items"
          params={params}
          countOf={countItems}
          renderPage={renderPage}
          skeleton={<ItemRowsSkeleton />}
          loadMoreLabel={s.items.loadMore}
          empty={
            <Empty className="border-0 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <EmptyIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {narrowed
                    ? s.items.empty.filtered
                    : emptyTitles[filters.scope]}
                </EmptyTitle>
              </EmptyHeader>
              {narrowed ? (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchInput("");
                      setFilters(clearNarrowingFilters);
                    }}
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
