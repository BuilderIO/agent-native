import {
  IconArrowLeft,
  IconChevronRight,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useMemo, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { WorkflowCatalog } from "@/lib/workflow-editor";

import { NODE_KIND_ICONS } from "../node-kinds";
import type { PaletteEntry } from "../palette";
import { ProviderIcon, providerIdentity } from "../provider-identity";
import {
  useWorkflowCanvasStrings,
  type WorkflowCanvasStrings,
} from "../strings";
import {
  creatorGroups,
  highlightedRow,
  moveHighlight,
  type CreatorGroupId,
  type CreatorRow,
  type CreatorTarget,
  type ProviderLinkStatus,
} from "./creator-model";

export type { CreatorTarget } from "./creator-model";

interface NodeCreatorProps {
  catalog: WorkflowCatalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CreatorTarget;
  hasTrigger: boolean;
  /** Each provider's status for this person. A provider left out reads as `unknown`. */
  connections?: Readonly<Record<string, ProviderLinkStatus>>;
  onPick: (entry: PaletteEntry) => void;
  /** Receives the query when nothing matches. Without it, that row is not offered. */
  onDescribe?: (query: string) => void;
  /** Receives a provider whose Connect control was used. Without it, no control shows. */
  onConnect?: (provider: string) => void;
  /** Where focus goes when the sheet closes. Radix would send it back to whatever opened the sheet. */
  onCloseAutoFocus?: (event: Event) => void;
}

interface Browse {
  query: string;
  provider: string | null;
  highlight: string | null;
}

const FRESH: Browse = { query: "", provider: null, highlight: null };

/**
 * One searchable list of what a new step can do, in sections. A provider row
 * opens that provider's operations. Picking an entry closes the creator and the
 * caller places the step; Escape backs out of a provider before it closes.
 */
export function NodeCreator({
  catalog,
  open,
  onOpenChange,
  target,
  hasTrigger,
  connections,
  onPick,
  onDescribe,
  onConnect,
  onCloseAutoFocus,
}: NodeCreatorProps) {
  const s = useWorkflowCanvasStrings();
  const [browse, setBrowse] = useState<Browse>(FRESH);
  // Every opening starts at the top level with an empty search.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setBrowse(FRESH);
  }
  const { query, provider, highlight } = browse;
  const describable = onDescribe !== undefined;
  const groups = useMemo(
    () =>
      creatorGroups({
        catalog,
        target,
        hasTrigger,
        browse: { query, provider },
        describable,
        strings: s,
      }),
    [catalog, target, hasTrigger, query, provider, describable, s],
  );
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const nothingMatches =
    query.trim() !== "" && rows.every((row) => row.type === "describe");
  const active = highlightedRow(rows, highlight);

  const update = (next: Partial<Browse>) =>
    setBrowse((current) => ({ ...current, ...next }));
  const openProvider = (next: string | null) =>
    update({ provider: next, query: "", highlight: null });

  const choose = (row: CreatorRow) => {
    if (row.type === "provider") {
      openProvider(row.provider);
      return;
    }
    if (row.type === "entry") onPick(row.entry);
    else onDescribe?.(query.trim());
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      update({
        highlight: moveHighlight(
          rows,
          active?.id ?? null,
          event.key === "ArrowDown" ? 1 : -1,
        ),
      });
    } else if (event.key === "Enter" && active) {
      // Taking the key here keeps the list's own Enter handling from picking a second time.
      event.preventDefault();
      choose(active);
    }
  };

  const title =
    target.kind === "insert" ? s.creator.insertOnEdge : s.toolbar.addStep;
  const headings: Record<CreatorGroupId, string> = {
    triggers: s.creator.triggers,
    actions: s.creator.actions,
    flow: s.creator.flow,
    ai: s.creator.ai,
  };
  const linkOf = (name: string): ProviderLinkStatus =>
    connections?.[name] ?? "unknown";

  const renderRow = (row: CreatorRow) => {
    switch (row.type) {
      case "entry": {
        const KindIcon = NODE_KIND_ICONS[row.entry.kind];
        return (
          <CommandItem key={row.id} value={row.id} onSelect={() => choose(row)}>
            <KindIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{row.entry.label}</span>
            <span className="ms-auto shrink-0 ps-2 text-xs text-muted-foreground">
              {row.detail}
            </span>
          </CommandItem>
        );
      }
      case "provider":
        return (
          <CommandItem key={row.id} value={row.id} onSelect={() => choose(row)}>
            <ProviderIcon provider={row.provider} />
            <span className="min-w-0 truncate">
              {providerIdentity(row.provider).label}
            </span>
            <span className="ms-auto flex shrink-0 items-center gap-2 ps-2">
              <ConnectionState
                provider={row.provider}
                status={linkOf(row.provider)}
                strings={s}
                onConnect={onConnect}
              />
            </span>
            <IconChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </CommandItem>
        );
      case "describe":
        return (
          <CommandItem key={row.id} value={row.id} onSelect={() => choose(row)}>
            <IconMessageCircle className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{s.creator.describeIt}</span>
          </CommandItem>
        );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="gap-0 p-0"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (provider === null) return;
          event.preventDefault();
          openProvider(null);
        }}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <Command
          shouldFilter={false}
          value={active?.id ?? ""}
          onValueChange={(value) => update({ highlight: value })}
          onKeyDown={onKeyDown}
          className="rounded-none bg-background"
        >
          <CommandInput
            autoFocus
            value={query}
            onValueChange={(next) => update({ query: next, highlight: null })}
            placeholder={s.creator.searchPlaceholder}
            className="pe-10"
          />
          {provider === null ? null : (
            <div className="flex items-center gap-2 border-b px-2 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openProvider(null)}
              >
                <IconArrowLeft />
                {s.creator.back}
              </Button>
              <span className="ms-auto flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="truncate">
                  {providerIdentity(provider).label}
                </span>
                <ConnectionState
                  provider={provider}
                  status={linkOf(provider)}
                  strings={s}
                  onConnect={onConnect}
                />
              </span>
            </div>
          )}
          <CommandList label={title} className="max-h-none min-h-0 flex-1">
            {nothingMatches && (
              <p className="text-muted-foreground px-3 py-2 text-sm">
                {s.creator.noResults}
              </p>
            )}
            {groups.map((group) => (
              <CommandGroup
                key={group.heading ?? "rows"}
                heading={group.heading ? headings[group.heading] : undefined}
              >
                {group.rows.map(renderRow)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </SheetContent>
    </Sheet>
  );
}

/** Connected reads as a word; not connected reads as a word and a Connect control; unknown shows nothing. */
function ConnectionState({
  provider,
  status,
  strings: s,
  onConnect,
}: {
  provider: string;
  status: ProviderLinkStatus;
  strings: WorkflowCanvasStrings;
  onConnect?: (provider: string) => void;
}) {
  if (status === "unknown") return null;
  if (status === "connected") {
    return (
      <span className="text-xs text-muted-foreground">
        {s.creator.connected}
      </span>
    );
  }
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {s.creator.notConnected}
      </span>
      {onConnect ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={(event) => {
            // Inside a list row, the press must not also pick the row.
            event.stopPropagation();
            onConnect(provider);
          }}
        >
          {s.creator.connect}
        </Button>
      ) : null}
    </>
  );
}
