import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCornerDownRight,
  IconFileText,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
  isFilesRowCreationPending,
  useFilesNavigationPage,
} from "@/lib/files-navigation";

import { SidebarRowIcon, SidebarRowsSkeleton } from "./SidebarNavigationRow";

export interface MovePageTarget {
  documentId: string;
  title: string;
  spaceId: string | null;
}

export interface MovePageSpace {
  id: string;
  name: string;
  filesDatabaseId: string;
  orgId: string | null;
}

export interface MovePageDestination {
  spaceId: string;
  parentId: string | null;
}

function MovePageDestinationList({
  databaseId,
  excludedId,
  choose,
}: {
  databaseId: string;
  excludedId: string | undefined;
  choose: (parentId: string | null) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  function restart() {
    setUnavailable(false);
    setGeneration((value) => value + 1);
    void queryClient.invalidateQueries({
      queryKey: filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId,
          parentId: null,
          pagesOnly: true,
        }),
      ),
      exact: true,
      refetchType: "none",
    });
  }
  return (
    <>
      <CommandItem value="__top-level__" onSelect={() => choose(null)}>
        <IconCornerDownRight className="me-2 size-4 text-muted-foreground" />
        {t("sidebar.topLevel")}
      </CommandItem>
      {unavailable ? (
        <CommandItem value="__unavailable__" onSelect={restart}>
          {t("empty.genericError")} {t("root.searchRetry")}
        </CommandItem>
      ) : (
        <MovePageDestinations
          key={generation}
          databaseId={databaseId}
          excludedId={excludedId}
          choose={choose}
          precedingIds={new Set()}
          onUnavailable={() => setUnavailable(true)}
        />
      )}
    </>
  );
}

function MovePageDestinations({
  databaseId,
  excludedId,
  choose,
  precedingIds,
  cursor,
  onUnavailable,
}: {
  databaseId: string;
  excludedId: string | undefined;
  choose: (parentId: string | null) => void;
  precedingIds: ReadonlySet<string>;
  cursor?: string;
  onUnavailable: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [showNext, setShowNext] = useState(false);
  const result = useFilesNavigationPage(
    filesNavigationPageParams({
      databaseId,
      parentId: null,
      pagesOnly: true,
      ...(cursor === undefined ? {} : { cursor }),
    }),
    undefined,
    { refetchOnMount: "always" },
  );
  const unavailable = Boolean(result.data && "available" in result.data);
  const invalidCursor = Boolean(
    cursor &&
    (result.error as { errorCode?: unknown } | null)?.errorCode ===
      "invalid_navigation_cursor",
  );
  useEffect(() => {
    if ((unavailable && !result.isFetching) || invalidCursor) onUnavailable();
  }, [unavailable, invalidCursor, result.isFetching, onUnavailable]);
  if (invalidCursor) return null;
  if (result.isError) {
    return (
      <CommandItem
        value={`__retry-${cursor ?? "first"}__`}
        onSelect={() => void result.refetch()}
      >
        {t("empty.genericError")} {t("root.searchRetry")}
      </CommandItem>
    );
  }
  if (result.isFetching || !result.data || "available" in result.data)
    return <SidebarRowsSkeleton rows={3} framed={false} />;
  const items = result.data.items.filter(
    (item) =>
      item.type === "page" &&
      item.documentId !== excludedId &&
      !precedingIds.has(item.documentId) &&
      !isFilesRowCreationPending(queryClient, item.documentId),
  );
  const seen = new Set([
    ...precedingIds,
    ...items.map((item) => item.documentId),
  ]);
  const nextCursor = result.data.pagination.hasMore
    ? result.data.pagination.nextCursor
    : null;
  return (
    <>
      {items.map((item) => (
        <CommandItem
          key={item.documentId}
          value={item.documentId}
          onSelect={() => choose(item.documentId)}
          className="gap-2"
        >
          <SidebarRowIcon
            icon={
              item.icon || (
                <IconFileText className="size-4 text-muted-foreground" />
              )
            }
          />
          <span className="min-w-0 flex-1 truncate">
            {item.title || t("sidebar.untitled")}
          </span>
        </CommandItem>
      ))}
      {nextCursor ? (
        showNext ? (
          <MovePageDestinations
            key={nextCursor}
            databaseId={databaseId}
            excludedId={excludedId}
            choose={choose}
            precedingIds={seen}
            cursor={nextCursor}
            onUnavailable={onUnavailable}
          />
        ) : (
          <CommandItem
            value={`__more-${nextCursor}__`}
            onSelect={() => setShowNext(true)}
            className="justify-center text-muted-foreground"
          >
            {t("sidebar.showMore")}
          </CommandItem>
        )
      ) : null}
    </>
  );
}

function SearchMovePageDestinations({
  query,
  spaceId,
  excludedId,
  choose,
  precedingIds,
  offset = 0,
}: {
  query: string;
  spaceId: string;
  excludedId: string;
  choose: (parentId: string | null) => void;
  precedingIds: ReadonlySet<string>;
  offset?: number;
}) {
  const t = useT();
  const [showNext, setShowNext] = useState(false);
  const result = useActionQuery(
    "search-documents",
    {
      query,
      spaceId,
      searchFields: "title",
      documentType: "page",
      excludeSubtreeOf: excludedId,
      limit: 20,
      offset,
    },
    { refetchOnMount: "always" },
  );
  if (result.isError) {
    return (
      <CommandItem
        value={`__retry-search-${offset}__`}
        onSelect={() => void result.refetch()}
      >
        {t("empty.genericError")} {t("root.searchRetry")}
      </CommandItem>
    );
  }
  const data = result.data as
    | {
        documents: Array<{
          id: string;
          title: string;
          icon: string | null;
          parentTitle: string | null;
          sourceKind: string | null;
        }>;
        pagination: { hasMore: boolean; nextOffset: number | null };
      }
    | undefined;
  if (result.isFetching || !data)
    return <SidebarRowsSkeleton rows={3} framed={false} />;
  const choices = data.documents.filter(
    (item) =>
      item.id !== excludedId &&
      item.sourceKind !== "folder" &&
      !precedingIds.has(item.id),
  );
  const seen = new Set([...precedingIds, ...choices.map((item) => item.id)]);
  const nextOffset = data.pagination.hasMore
    ? data.pagination.nextOffset
    : null;
  return (
    <>
      {offset === 0 && choices.length === 0 && nextOffset === null ? (
        <div className="py-6 text-center text-sm">
          {t("sidebar.noMatchingPages")}
        </div>
      ) : null}
      {choices.map((destination) => (
        <CommandItem
          key={destination.id}
          value={destination.id}
          onSelect={() => choose(destination.id)}
          className="gap-2"
        >
          <SidebarRowIcon
            icon={
              destination.icon || (
                <IconFileText className="size-4 text-muted-foreground" />
              )
            }
          />
          <span className="min-w-0 flex-1 truncate">
            {destination.title || t("sidebar.untitled")}
          </span>
          {destination.parentTitle ? (
            <span className="max-w-[40%] truncate text-xs text-muted-foreground">
              {destination.parentTitle}
            </span>
          ) : null}
        </CommandItem>
      ))}
      {nextOffset !== null ? (
        showNext ? (
          <SearchMovePageDestinations
            key={nextOffset}
            query={query}
            spaceId={spaceId}
            excludedId={excludedId}
            choose={choose}
            precedingIds={seen}
            offset={nextOffset}
          />
        ) : (
          <CommandItem
            value={`__more-search-${nextOffset}__`}
            onSelect={() => setShowNext(true)}
            className="justify-center text-muted-foreground"
          >
            {t("sidebar.showMore")}
          </CommandItem>
        )
      ) : null}
    </>
  );
}

export function MovePageDialog({
  page,
  spaces,
  onOpenChange,
  onMove,
}: {
  page: MovePageTarget | null;
  spaces: MovePageSpace[];
  onOpenChange: (open: boolean) => void;
  onMove: (page: MovePageTarget, destination: MovePageDestination) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null);
  const [pendingParentId, setPendingParentId] = useState<
    string | null | undefined
  >(undefined);
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 150);
    return () => window.clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    setSearch("");
    setQuery("");
    setPendingParentId(undefined);
    setTargetSpaceId(page?.spaceId ?? spaces[0]?.id ?? null);
    // Reset only when a different Page opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.documentId]);

  const space =
    spaces.find((candidate) => candidate.id === targetSpaceId) ?? null;
  const crossSpace = Boolean(space && page && space.id !== page.spaceId);
  const open = page !== null && space !== null;

  function move(parentId: string | null) {
    if (!page || !space) return;
    onMove(page, { spaceId: space.id, parentId });
    onOpenChange(false);
  }

  function choose(parentId: string | null) {
    if (crossSpace) setPendingParentId(parentId);
    else move(parentId);
  }

  const confirming = pendingParentId !== undefined && space && page;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="flex min-w-0 items-center gap-2 px-4 pt-4 pb-2 pe-12">
          <DialogTitle className="min-w-0 truncate text-sm font-medium">
            {t("sidebar.movePageTo", { title: page?.title ?? "" })}
          </DialogTitle>
          {spaces.length > 1 && !confirming ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-7 min-w-0 shrink gap-1 px-2 text-sm"
                  aria-label={t("sidebar.chooseSpace")}
                >
                  <span className="truncate">{space?.name}</span>
                  <IconChevronDown className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuRadioGroup
                  value={targetSpaceId ?? ""}
                  onValueChange={(value) => {
                    setTargetSpaceId(value);
                    setSearch("");
                    setQuery("");
                  }}
                >
                  {spaces.map((candidate) => (
                    <DropdownMenuRadioItem
                      key={candidate.id}
                      value={candidate.id}
                    >
                      <span className="truncate">{candidate.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {confirming ? (
          <div className="grid gap-4 px-4 pt-2 pb-4" data-move-space-warning>
            <div className="flex gap-3">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="grid gap-1 text-sm">
                <p className="font-medium">
                  {t("sidebar.moveToSpaceTitle", { space: space.name })}
                </p>
                <p className="text-muted-foreground">
                  {space.orgId
                    ? t("sidebar.moveToSpaceWarningShared", {
                        title: page.title,
                        space: space.name,
                      })
                    : t("sidebar.moveToSpaceWarningPrivate", {
                        title: page.title,
                        space: space.name,
                      })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingParentId(undefined)}
              >
                {t("sidebar.back")}
              </Button>
              <Button
                size="sm"
                autoFocus
                onClick={() => move(pendingParentId ?? null)}
              >
                {t("sidebar.movePage")}
              </Button>
            </div>
          </div>
        ) : (
          <Command shouldFilter={false} className="rounded-none">
            <CommandInput
              ref={searchRef}
              value={search}
              onValueChange={setSearch}
              placeholder={t("sidebar.searchPages")}
              aria-label={t("sidebar.searchPages")}
            />
            <CommandList className="max-h-80">
              <CommandGroup>
                {open && query === "" && search.trim() === query ? (
                  <MovePageDestinationList
                    key={space.id}
                    databaseId={space.filesDatabaseId}
                    excludedId={page.documentId}
                    choose={choose}
                  />
                ) : null}
                {open && query !== "" && search.trim() === query ? (
                  <SearchMovePageDestinations
                    key={`${space.id}:${query}`}
                    query={query}
                    spaceId={space.id}
                    excludedId={page.documentId}
                    choose={choose}
                    precedingIds={new Set()}
                  />
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
