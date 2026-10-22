import { IconSearch } from "@tabler/icons-react";

import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useItemsStrings } from "../items-strings";
import { FilterSelect, type FilterOption } from "./FilterSelect";
import { KNOWN_SOURCE_IDS, sourceLabel } from "./item-status";
import {
  parseItemsScope,
  type ItemsFilterState,
  type ItemsScope,
} from "./items-query";
import type { WorkflowOption } from "./read-types";

const SCOPES: ItemsScope[] = ["needs_you", "parked", "dismissed", "all"];

export function ItemsFilters({
  filters,
  searchInput,
  workflows,
  workflowsLoading,
  onScope,
  onWorkflow,
  onSource,
  onSearchInput,
}: {
  filters: ItemsFilterState;
  searchInput: string;
  workflows: readonly WorkflowOption[];
  workflowsLoading: boolean;
  onScope: (scope: ItemsScope) => void;
  onWorkflow: (workflowId: string | null) => void;
  onSource: (source: string | null) => void;
  onSearchInput: (value: string) => void;
}) {
  const s = useItemsStrings();
  const scopeLabels: Record<ItemsScope, string> = {
    needs_you: s.items.filter.needsYou,
    parked: s.items.filter.parked,
    dismissed: s.items.filter.dismissed,
    all: s.items.filter.all,
  };
  const sourceOptions: FilterOption[] = KNOWN_SOURCE_IDS.map((id) => ({
    value: id,
    label: sourceLabel(id, s) ?? id,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filters.scope}
        aria-label={s.items.filterGroupLabel}
        onValueChange={(value) => {
          const scope = parseItemsScope(value);
          // Clicking the active segment reports an empty value; one segment always stays on.
          if (scope) onScope(scope);
        }}
      >
        {SCOPES.map((scope) => (
          <ToggleGroupItem key={scope} value={scope}>
            {scopeLabels[scope]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FilterSelect
        label={s.items.workflowLabel}
        value={filters.workflowId}
        noneLabel={s.items.allWorkflows}
        disabled={workflowsLoading}
        options={workflows.map((workflow) => ({
          value: workflow.id,
          label: workflow.name,
        }))}
        onChange={onWorkflow}
      />
      <FilterSelect
        label={s.items.sourceLabel}
        value={filters.source}
        noneLabel={s.items.allSources}
        options={sourceOptions}
        onChange={onSource}
      />
      <div className="relative min-w-44 flex-1 sm:max-w-64">
        <IconSearch
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          size="sm"
          value={searchInput}
          maxLength={100}
          aria-label={s.items.searchLabel}
          placeholder={s.items.searchBy}
          className="ps-8"
          onChange={(event) => onSearchInput(event.target.value)}
        />
      </div>
    </div>
  );
}
