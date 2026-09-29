import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseNavigationPageResponse } from "@shared/api";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCornerDownRight,
  IconFileText,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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

import { SidebarRowIcon } from "./SidebarNavigationRow";

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

type Destination = {
  id: string;
  title: string;
  icon: string | null;
  context: string | null;
};

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

  const roots = useActionQuery(
    "query-content-database-items",
    {
      databaseId: space?.filesDatabaseId ?? "",
      limit: 20,
      navigation: { parentId: null, sort: "custom" },
    },
    { enabled: open && query === "" },
  );
  const results = useActionQuery(
    "search-documents",
    {
      query,
      spaceId: space?.id,
      searchFields: "title",
      documentType: "page",
      excludeSubtreeOf: page?.documentId,
      limit: 20,
    },
    { enabled: open && query !== "" },
  );

  const destinations: Destination[] =
    query === ""
      ? (
          (roots.data as ContentDatabaseNavigationPageResponse | undefined)
            ?.items ?? []
        )
          .filter((item) => item.type === "page")
          .map((item) => ({
            id: item.documentId,
            title: item.title,
            icon: item.icon,
            context: null,
          }))
      : (
          (
            results.data as
              | {
                  documents?: Array<{
                    id: string;
                    title: string;
                    icon: string | null;
                    parentTitle: string | null;
                  }>;
                }
              | undefined
          )?.documents ?? []
        ).map((document) => ({
          id: document.id,
          title: document.title,
          icon: document.icon,
          context: document.parentTitle,
        }));
  const loading = query === "" ? roots.isLoading : results.isLoading;
  const choices = destinations.filter(
    (destination) => destination.id !== page?.documentId,
  );

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
              {!loading ? (
                <CommandEmpty>{t("sidebar.noMatchingPages")}</CommandEmpty>
              ) : null}
              <CommandGroup>
                {query === "" ? (
                  <CommandItem
                    value="__top-level__"
                    onSelect={() => choose(null)}
                  >
                    <IconCornerDownRight className="me-2 size-4 text-muted-foreground" />
                    {t("sidebar.topLevel")}
                  </CommandItem>
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
                    {destination.context ? (
                      <span className="max-w-[40%] truncate text-xs text-muted-foreground">
                        {destination.context}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
