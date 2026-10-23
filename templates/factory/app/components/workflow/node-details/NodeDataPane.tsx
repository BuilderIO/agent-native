import { IconSearch } from "@tabler/icons-react";
import { useMemo, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { NodeDataItem } from "../../../../server/workflow-host/read-models.js";
import { useItemsStrings } from "../items-strings";
import { useWorkflowStrings } from "../workflow-strings";
import {
  includesText,
  itemText,
  kindAt,
  schemaOf,
  storedItemsOf,
  tableColumnsOf,
  type Segment,
} from "./node-data-model";
import { JsonView } from "./NodeDataJson";
import { SchemaView } from "./NodeDataSchema";
import { EmptyData } from "./NodeDataStates";
import { TableView } from "./NodeDataTable";
import { DATA_VIEWS, isDataView, type DataView } from "./use-node-data-view";

/** One column of the details modal: its title and view switch, an optional row of pickers, the count and search, then the items. */
export function DataPane({
  title,
  mark,
  view,
  onView,
  picker,
  toolbar,
  className,
  children,
}: {
  title: string;
  /** The run's status mark, shown after the title. */
  mark?: ReactNode;
  view: DataView;
  onView: (view: DataView) => void;
  /** A row above the count: the input's source, or the output's ports. */
  picker?: ReactNode;
  /** The count and search. Left out when there are no items to count. */
  toolbar?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ws = useWorkflowStrings();
  return (
    <section
      aria-label={title}
      className={cn("flex min-h-0 min-w-70 flex-1 basis-0 flex-col", className)}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border ps-4 pe-2">
        <h3 className="min-w-0 truncate text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {mark}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          aria-label={ws.nodeData.viewLabel}
          className="ms-auto shrink-0"
          onValueChange={(next) => {
            // Clicking the active segment reports an empty value; one segment always stays on.
            if (isDataView(next)) onView(next);
          }}
        >
          {DATA_VIEWS.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {ws.nodeData.view[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>
      {picker ? <div className="shrink-0 px-4 pt-3">{picker}</div> : null}
      {toolbar ? <div className="shrink-0 px-4 pt-3">{toolbar}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </section>
  );
}

export function CountAndSearch({
  count,
  truncated,
  draft,
  onDraft,
}: {
  count: string;
  /** A stored item was cut to fit, and the schema merges items so it says so here. */
  truncated: boolean;
  draft: string;
  onDraft: (value: string) => void;
}) {
  const ws = useWorkflowStrings();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="me-auto text-xs tabular-nums text-muted-foreground">
        {count}
      </p>
      {truncated ? (
        <Badge variant="outline">{ws.nodeData.truncated}</Badge>
      ) : null}
      <div className="relative w-44 max-w-full">
        <IconSearch
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={draft}
          placeholder={ws.nodeData.search}
          aria-label={ws.nodeData.search}
          size="sm"
          className="ps-8"
          onChange={(event) => onDraft(event.target.value)}
        />
      </div>
    </div>
  );
}

/** The count line for a port: "N items", "X of Y shown" when the server cut it, and "X of Y items" while a table or JSON search narrows it. */
export function useCountText(): (
  port: {
    count: number;
    items: readonly NodeDataItem[];
    itemsTruncated: boolean;
  },
  matching: number | null,
) => string {
  const ws = useWorkflowStrings();
  const { audit } = useItemsStrings();
  return (port, matching) => {
    if (matching !== null)
      return ws.nodeData.ofTotal(matching, port.items.length);
    if (port.itemsTruncated)
      return audit.moreItems(port.items.length, port.count);
    return ws.nodeData.count(port.count);
  };
}

/** The items a view shows. The schema shows every item's fields, and search narrows its fields instead. */
export function rowsFor(
  items: readonly NodeDataItem[],
  view: DataView,
  query: string,
): readonly NodeDataItem[] {
  return view === "schema"
    ? items
    : items.filter((item) => includesText(itemText(item), query));
}

/** The items in one of the three views. The caller has checked there are items to show. */
export function DataItems({
  view,
  items,
  rows,
  query,
  onClear,
  dragSource = false,
}: {
  view: DataView;
  items: readonly NodeDataItem[];
  /** The items the table or JSON view shows, after search. */
  rows: readonly NodeDataItem[];
  query: string;
  onClear: () => void;
  /** The fields can be dragged onto a path or template field. Only the Input pane sets it. */
  dragSource?: boolean;
}) {
  const ws = useWorkflowStrings();
  const stored = useMemo(() => storedItemsOf(items), [items]);
  const fields = useMemo(() => schemaOf(stored), [stored]);
  const columns = useMemo(() => tableColumnsOf(stored), [stored]);
  // The kind comes from every stored item, not the search's rows, so a search does not change it.
  const dragKindAt = (segments: readonly Segment[]) => kindAt(stored, segments);
  if (view === "schema") {
    if (stored.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">{ws.nodeData.onlyIds}</p>
      );
    }
    return (
      <SchemaView
        fields={fields}
        query={query}
        onClear={onClear}
        dragSource={dragSource}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyData
        title={ws.nodeData.noMatchingItems}
        action={
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            {ws.nodeData.clearSearch}
          </Button>
        }
      />
    );
  }
  if (view === "table") {
    return <TableView rows={rows} columns={columns} dragSource={dragSource} />;
  }
  return (
    <JsonView items={rows} dragKindAt={dragSource ? dragKindAt : undefined} />
  );
}
