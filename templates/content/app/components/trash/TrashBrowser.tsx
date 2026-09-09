import { setClientAppState } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import {
  useContentTrash,
  type ContentTrashFilters,
} from "@/hooks/use-content-trash";

function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          className="max-w-48 truncate"
        >
          {options.find((option) => option.value === value)?.label ?? label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TrashBrowser({
  renderActions,
}: {
  renderActions?: (
    items: ContentTrashItem[],
    onComplete: () => void,
  ) => ReactNode;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const [filters, setFilters] = useState<ContentTrashFilters>({});
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedParent, setSelectedParent] = useState<{
    value: string;
    label: string;
  } | null>(null);
  const query = useContentTrash({
    ...filters,
    cursor: cursors[cursors.length - 1],
  });
  const spaces = useContentSpaces();
  const items = query.data?.items;
  const selection = useMemo(
    () => (items ?? []).filter((item) => selected.includes(item.documentId)),
    [items, selected],
  );
  const parents = useMemo(() => {
    const options = new Map<string, string>();
    if (selectedParent) options.set(selectedParent.value, selectedParent.label);
    for (const item of items ?? []) {
      if (item.parentId && item.parentTitle)
        options.set(item.parentId, item.parentTitle);
    }
    return [...options].map(([value, label]) => ({ value, label }));
  }, [items, selectedParent]);
  function changeFilters(patch: Partial<ContentTrashFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([undefined]);
    setSelected([]);
  }
  useEffect(() => {
    void setClientAppState(
      "trash-selection",
      {
        documentIds: selection.map((item) => item.documentId),
        databaseIds: selection.flatMap((item) =>
          item.databaseId ? [item.databaseId] : [],
        ),
        filters,
      },
      { requestSource: "content-trash" },
    ).catch(console.error);
  }, [selection, filters]);
  useEffect(
    () => () => {
      void setClientAppState("trash-selection", null, {
        requestSource: "content-trash",
      }).catch(console.error);
    },
    [],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input
          className="h-8 w-full sm:w-64"
          aria-label={t("trashBrowser.search")}
          placeholder={t("trashBrowser.search")}
          value={filters.query ?? ""}
          onChange={(event) =>
            changeFilters({ query: event.target.value || undefined })
          }
        />
        <FilterMenu
          label={t("trashBrowser.kind")}
          value={filters.kind ?? ""}
          options={[
            { value: "", label: t("trashBrowser.allKinds") },
            { value: "page", label: t("trashBrowser.pages") },
            { value: "database", label: t("trashBrowser.databases") },
          ]}
          onChange={(value) =>
            changeFilters({
              kind: value ? (value as "page" | "database") : undefined,
            })
          }
        />
        {spaces.isError ? (
          <QueryErrorState
            compact
            onRetry={() => void spaces.refetch()}
            retrying={spaces.isFetching}
          />
        ) : spaces.isPending ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <FilterMenu
            label={t("trashBrowser.space")}
            value={filters.spaceId ?? ""}
            options={[
              { value: "", label: t("trashBrowser.allSpaces") },
              ...(spaces.data?.spaces ?? []).map((space) => ({
                value: space.id,
                label: space.name,
              })),
            ]}
            onChange={(value) => changeFilters({ spaceId: value || undefined })}
          />
        )}
        <FilterMenu
          label={t("trashBrowser.location")}
          value={filters.parentId ?? ""}
          options={[
            { value: "", label: t("trashBrowser.allLocations") },
            ...parents,
          ]}
          onChange={(value) => {
            setSelectedParent(
              parents.find((option) => option.value === value) ?? null,
            );
            changeFilters({ parentId: value || undefined });
          }}
        />
        <Input
          className="h-8 w-full sm:w-48"
          aria-label={t("trashBrowser.actor")}
          placeholder={t("trashBrowser.actor")}
          value={filters.actor ?? ""}
          onChange={(event) =>
            changeFilters({ actor: event.target.value || undefined })
          }
        />
        {filters.groupId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeFilters({ groupId: undefined })}
          >
            {t("trashBrowser.clearGroup")}
          </Button>
        )}
      </div>
      {query.isError ? (
        <QueryErrorState
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex min-h-12 flex-wrap items-center gap-3 border-b px-4 py-2">
            <Checkbox
              aria-label={t("trashBrowser.selectVisible")}
              disabled={!items?.length}
              checked={
                !!items?.length && selection.length === items.length
                  ? true
                  : selection.length
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                setSelected(
                  checked === true
                    ? (items ?? []).map((item) => item.documentId)
                    : [],
                )
              }
            />
            {selection.length > 0 && (
              <span className="text-sm">
                {t("trashBrowser.selected", { count: selection.length })}
              </span>
            )}
            {renderActions?.(selection, () => {
              setSelected([]);
              void query.refetch();
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!items?.length ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {t(
                  Object.values(filters).some(Boolean)
                    ? "trashBrowser.noResults"
                    : "trashBrowser.empty",
                )}
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.documentId}
                  className="flex items-center gap-3 border-b px-4 py-3"
                >
                  <Checkbox
                    aria-label={t("trashBrowser.select", { title: item.title })}
                    checked={selected.includes(item.documentId)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked === true
                          ? [...current, item.documentId]
                          : current.filter((id) => id !== item.documentId),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/page/${item.documentId}`}
                      className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {item.title || t("database.untitled")}
                    </Link>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t(
                          item.kind === "database"
                            ? "trashBrowser.databases"
                            : "trashBrowser.pages",
                        )}
                      </span>
                      {item.spaceName && <span>{item.spaceName}</span>}
                      {item.parentTitle && <span>{item.parentTitle}</span>}
                      <time dateTime={item.trashedAt}>
                        {formatDate(item.trashedAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      <span className="break-all">
                        {item.trashedBy ?? t("trashBrowser.unknownActor")}
                      </span>
                    </div>
                  </div>
                  {item.trashRootId && !filters.groupId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="max-w-28 whitespace-normal text-xs"
                      onClick={() =>
                        changeFilters({
                          groupId: item.trashRootId ?? undefined,
                        })
                      }
                    >
                      {t("trashBrowser.group")}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={cursors.length === 1 || query.isFetching}
              onClick={() => {
                setCursors((current) => current.slice(0, -1));
                setSelected([]);
              }}
            >
              {t("trashBrowser.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data?.nextCursor || query.isFetching}
              onClick={() => {
                if (query.data?.nextCursor)
                  setCursors((current) => [...current, query.data.nextCursor!]);
                setSelected([]);
              }}
            >
              {t("trashBrowser.next")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
