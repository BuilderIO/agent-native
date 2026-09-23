import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseNavigationPageResponse } from "@shared/api";
import { IconCornerDownRight, IconFileText } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { SidebarRowIcon } from "./SidebarNavigationRow";

export interface MovePageTarget {
  documentId: string;
  title: string;
}

type Destination = {
  id: string;
  title: string;
  icon: string | null;
  context: string | null;
};

/**
 * Pick a new parent for a Page within its Content space. Until the viewer
 * types, it lists the space's top-level Pages; typing searches Page titles in
 * that space. The Page itself is never offered, and the server still rejects
 * moving a Page under its own descendants.
 */
export function MovePageDialog({
  page,
  spaceId,
  filesDatabaseId,
  onOpenChange,
  onMove,
}: {
  page: MovePageTarget | null;
  spaceId: string;
  filesDatabaseId: string;
  onOpenChange: (open: boolean) => void;
  onMove: (page: MovePageTarget, parentId: string | null) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 150);
    return () => window.clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!page) {
      setSearch("");
      setQuery("");
    }
  }, [page]);

  const roots = useActionQuery(
    "query-content-database-items",
    {
      databaseId: filesDatabaseId,
      limit: 20,
      navigation: { parentId: null, sort: "custom" },
    },
    { enabled: Boolean(page) && query === "" },
  );
  const results = useActionQuery(
    "search-documents",
    {
      query,
      spaceId,
      searchFields: "title",
      documentType: "page",
      limit: 20,
    },
    { enabled: Boolean(page) && query !== "" },
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

  function choose(parentId: string | null) {
    if (!page) return;
    onMove(page, parentId);
    onOpenChange(false);
  }

  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Start in the search field rather than on the close button.
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <DialogTitle className="truncate px-4 pt-4 pb-2 text-sm font-medium">
          {t("sidebar.movePageTo", { title: page?.title ?? "" })}
        </DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
