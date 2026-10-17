import { useT } from "@agent-native/core/client/i18n";
import {
  IconAdjustmentsHorizontal,
  IconArrowsSort,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type Ref } from "react";

import {
  ContentTableConstraintBar,
  ContentTableConstraintChip,
  ContentTableSearch,
  ContentTableToolbar,
  ContentTableToolbarButton,
} from "@/components/editor/database/ContentTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";
import {
  changeTrashSort,
  type ContentTrashFilters,
  type ContentTrashSort,
} from "@/hooks/use-content-trash";

const FILTER_KEYS = [
  "kind",
  "spaceId",
  "createdBy",
  "updatedBy",
  "actor",
  "parentId",
  "deletedFrom",
  "deletedTo",
] as const;

const SORTS = [
  ["name", "trash.name"],
  ["createdAt", "trash.createdAtColumn"],
  ["updatedAt", "trash.updatedAtColumn"],
  ["deletedAt", "trash.deletedAtColumn"],
] as const;

export function TrashFilters({
  filters,
  onChange,
  onEmptyTrash,
  emptyTrashRef,
  spaces,
}: {
  filters: ContentTrashFilters;
  onChange: (filters: ContentTrashFilters) => void;
  onEmptyTrash: () => void;
  emptyTrashRef?: Ref<HTMLButtonElement>;
  spaces: ContentSpaceSummary[];
}) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(Boolean(filters.query));
  const active = FILTER_KEYS.filter((key) => filters[key]);
  const sortLabel = SORTS.find(([sort]) => sort === filters.sort)?.[1];
  const set = <K extends (typeof FILTER_KEYS)[number]>(
    key: K,
    value?: ContentTrashFilters[K],
  ) => onChange({ ...filters, [key]: value || undefined });
  const clearFilters = () =>
    onChange({
      query: filters.query,
      sort: filters.sort,
      direction: filters.direction,
    });
  const label = (key: (typeof FILTER_KEYS)[number]) => {
    const value = filters[key];
    if (key === "spaceId")
      return `${t("sidebar.workspaces")}: ${spaces.find((space) => space.id === value)?.name ?? value}`;
    if (key === "kind")
      return `${t("trash.kind")}: ${t(value === "database" ? "trash.collections" : "trash.pages")}`;
    const labelKey = {
      createdBy: "trash.createdBy",
      updatedBy: "trash.updatedBy",
      actor: "trash.deletedByColumn",
      parentId: "trash.location",
      deletedFrom: "trash.deletedFrom",
      deletedTo: "trash.deletedTo",
    }[key];
    return `${t(labelKey)}: ${value}`;
  };

  return (
    <div className="border-b">
      <ContentTableToolbar className="flex-nowrap justify-start px-3 py-1 sm:px-5">
        <ContentTableSearch
          open={searchOpen}
          value={filters.query ?? ""}
          label={t("trash.searchPlaceholder")}
          placeholder={t("trash.searchPlaceholder")}
          closeLabel={t("trash.closeSearch")}
          onOpenChange={setSearchOpen}
          onValueChange={(query) =>
            onChange({ ...filters, query: query || undefined })
          }
        />
        <Popover>
          <PopoverTrigger asChild>
            <ContentTableToolbarButton
              label={t("trash.sortBy")}
              active={Boolean(filters.sort)}
            >
              <IconArrowsSort className="size-3.5" />
            </ContentTableToolbarButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="grid w-64 gap-1 p-2">
            {SORTS.map(([sort, key]) => (
              <Button
                key={sort}
                type="button"
                size="sm"
                variant={
                  (filters.sort ?? "deletedAt") === sort ? "secondary" : "ghost"
                }
                className="justify-between"
                onClick={() =>
                  onChange(changeTrashSort(filters, sort as ContentTrashSort))
                }
              >
                {t(key)}
                {(filters.sort ?? "deletedAt") === sort ? (
                  <span aria-hidden>
                    {(filters.direction ?? "desc") === "asc" ? "↑" : "↓"}
                  </span>
                ) : null}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <ContentTableToolbarButton
              label={t("trash.filter")}
              active={active.length > 0}
              count={active.length || undefined}
            >
              <IconAdjustmentsHorizontal className="size-3.5" />
            </ContentTableToolbarButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="grid w-80 gap-3">
            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-medium">
                {t("sidebar.workspaces")}
              </legend>
              <div className="grid gap-1">
                {spaces.map((space) => (
                  <Button
                    key={space.id}
                    type="button"
                    size="sm"
                    variant={
                      filters.spaceId === space.id ? "secondary" : "ghost"
                    }
                    className="justify-start"
                    onClick={() =>
                      set(
                        "spaceId",
                        filters.spaceId === space.id ? undefined : space.id,
                      )
                    }
                  >
                    {space.name}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-medium">{t("trash.kind")}</legend>
              <div className="grid grid-cols-2 gap-1">
                {(["page", "database"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={filters.kind === kind ? "secondary" : "ghost"}
                    onClick={() =>
                      set("kind", filters.kind === kind ? undefined : kind)
                    }
                  >
                    {t(kind === "page" ? "trash.pages" : "trash.collections")}
                  </Button>
                ))}
              </div>
            </fieldset>
            <TrashFilterInput
              label={t("trash.createdBy")}
              value={filters.createdBy}
              placeholder={t("trash.actorPlaceholder")}
              onChange={(value) => set("createdBy", value)}
            />
            <TrashFilterInput
              label={t("trash.updatedBy")}
              value={filters.updatedBy}
              placeholder={t("trash.actorPlaceholder")}
              onChange={(value) => set("updatedBy", value)}
            />
            <TrashFilterInput
              label={t("trash.deletedByColumn")}
              value={filters.actor}
              placeholder={t("trash.actorPlaceholder")}
              onChange={(value) => set("actor", value)}
            />
            <TrashFilterInput
              label={t("trash.location")}
              value={filters.parentId}
              placeholder={t("trash.locationPlaceholder")}
              onChange={(value) => set("parentId", value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <TrashFilterInput
                type="date"
                label={t("trash.deletedFrom")}
                value={filters.deletedFrom?.slice(0, 10)}
                onChange={(value) =>
                  set(
                    "deletedFrom",
                    value ? `${value}T00:00:00.000Z` : undefined,
                  )
                }
              />
              <TrashFilterInput
                type="date"
                label={t("trash.deletedTo")}
                value={filters.deletedTo?.slice(0, 10)}
                onChange={(value) =>
                  set("deletedTo", value ? `${value}T23:59:59.999Z` : undefined)
                }
              />
            </div>
            {active.length ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t("trash.clearFilters")}
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
        <Button
          ref={emptyTrashRef}
          variant="ghost"
          size="sm"
          className="ms-auto h-7 shrink-0 gap-1.5 px-2 text-destructive hover:text-destructive"
          onClick={onEmptyTrash}
          disabled={spaces.length !== 1 && !filters.spaceId}
          aria-label={t("trash.emptyTrash")}
        >
          <IconTrash className="size-3.5" />
          <span className="hidden sm:inline">{t("trash.emptyTrash")}</span>
        </Button>
      </ContentTableToolbar>
      {filters.query || filters.sort || active.length ? (
        <ContentTableConstraintBar
          className="px-3 pb-2 sm:px-5"
          trailing={
            active.length ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={clearFilters}
              >
                {t("trash.clearFilters")}
              </Button>
            ) : undefined
          }
        >
          {filters.query ? (
            <ContentTableConstraintChip
              icon={<IconSearch className="size-3.5" />}
              label={`${t("trash.searchPlaceholder")}: ${filters.query}`}
              removeLabel={t("trash.searchPlaceholder")}
              onRemove={() => {
                onChange({ ...filters, query: undefined });
                setSearchOpen(false);
              }}
            />
          ) : null}
          {filters.sort && sortLabel ? (
            <ContentTableConstraintChip
              icon={<IconArrowsSort className="size-3.5" />}
              label={`${t("trash.sortBy")}: ${t(sortLabel)} ${(filters.direction ?? "desc") === "asc" ? "↑" : "↓"}`}
              removeLabel={t("trash.sortBy")}
              onRemove={() =>
                onChange({ ...filters, sort: undefined, direction: undefined })
              }
            />
          ) : null}
          {active.map((key) => (
            <ContentTableConstraintChip
              key={key}
              label={label(key)}
              removeLabel={t("trash.removeFilter", { filter: label(key) })}
              onRemove={() => set(key, undefined)}
            />
          ))}
        </ContentTableConstraintBar>
      ) : null}
    </div>
  );
}

function TrashFilterInput({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "date";
  onChange: (value?: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <Input
        size="sm"
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </label>
  );
}
