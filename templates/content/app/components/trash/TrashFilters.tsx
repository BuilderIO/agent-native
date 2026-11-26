import { useT } from "@agent-native/core/client/i18n";
import {
  FilterBar,
  FilterButton,
  activeFilterRuleCount,
  type FilterField,
  type FilterState,
} from "@agent-native/toolkit/app/filters";
import {
  IconArrowsSort,
  IconFilter,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  changeTrashSort,
  type ContentTrashFilters,
  type ContentTrashSort,
} from "@/hooks/use-content-trash";

const SORTS = [
  ["name", "trash.name"],
  ["createdAt", "trash.createdAtColumn"],
  ["updatedAt", "trash.updatedAtColumn"],
  ["deletedAt", "trash.deletedAtColumn"],
] as const;

export function TrashFilters({
  filters,
  onChange,
  fields,
  filterState,
  onFilterStateChange,
  onEmptyTrash,
  emptyTrashRef,
}: {
  filters: ContentTrashFilters;
  onChange: (filters: ContentTrashFilters) => void;
  fields: FilterField<never>[];
  filterState: FilterState;
  onFilterStateChange: (state: FilterState) => void;
  onEmptyTrash: () => void;
  emptyTrashRef?: Ref<HTMLButtonElement>;
}) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(Boolean(filters.query));
  const activeFilters = activeFilterRuleCount(filterState, fields);
  const sortLabel = SORTS.find(([sort]) => sort === filters.sort)?.[1];

  return (
    <div className="grid gap-2">
      <ContentTableToolbar className="flex-nowrap">
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
        <FilterButton
          fields={fields}
          state={filterState}
          onChange={onFilterStateChange}
          nouns={{ items: t("trash.filterItems") }}
          nestedGroups
          groupMode="and"
          align="end"
        >
          <ContentTableToolbarButton
            label={t("trash.filter")}
            active={activeFilters > 0}
            count={activeFilters || undefined}
          >
            <IconFilter className="size-3.5" />
          </ContentTableToolbarButton>
        </FilterButton>
        <Button
          ref={emptyTrashRef}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onEmptyTrash}
          aria-label={t("trash.emptyTrash")}
        >
          <IconTrash className="size-3.5" />
          <span className="hidden sm:inline">{t("trash.emptyTrash")}</span>
        </Button>
      </ContentTableToolbar>
      {filters.query || filters.sort || filterState.items.length ? (
        <ContentTableConstraintBar>
          {filters.sort && sortLabel ? (
            <ContentTableConstraintChip
              icon={<IconArrowsSort className="size-3.5" />}
              label={`${t("trash.sortBy")}: ${t(sortLabel)} ${(filters.direction ?? "desc") === "asc" ? "↑" : "↓"}`}
              removeLabel={t("trash.removeFilter", {
                filter: t("trash.sortBy"),
              })}
              onRemove={() => {
                const {
                  sort: _sort,
                  direction: _direction,
                  ...unsorted
                } = filters;
                onChange(unsorted);
              }}
            />
          ) : null}
          {filters.sort ? (
            <div
              aria-hidden="true"
              className="mx-1 h-4 w-px shrink-0 bg-border"
            />
          ) : null}
          <FilterBar
            fields={fields}
            state={filterState}
            onChange={onFilterStateChange}
            nestedGroups
            groupMode="and"
            clearable={false}
          />
          {filters.query ? (
            <ContentTableConstraintChip
              icon={<IconSearch className="size-3.5" />}
              label={`${t("trash.searchPlaceholder")}: ${filters.query}`}
              removeLabel={t("trash.removeFilter", {
                filter: t("trash.searchPlaceholder"),
              })}
              onRemove={() => {
                onChange({ ...filters, query: undefined });
                setSearchOpen(false);
              }}
            />
          ) : null}
        </ContentTableConstraintBar>
      ) : null}
    </div>
  );
}
