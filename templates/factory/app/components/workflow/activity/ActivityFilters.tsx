import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useItemsStrings } from "../items-strings";
import { FilterSelect, type FilterOption } from "../items/FilterSelect";
import type { WorkflowOption } from "../items/read-types";
import type {
  ActivityFilterState,
  ActivityKindFilter,
  ActivityRange,
  ActivityWhoFilter,
} from "./activity-model";

const KIND_ALL = "all";

function parseKind(value: string): ActivityKindFilter | null | undefined {
  if (value === KIND_ALL) return null;
  return value === "run" || value === "change" || value === "needs_you"
    ? value
    : undefined;
}

export function ActivityFilters({
  filters,
  workflows,
  workflowsLoading,
  onChange,
}: {
  filters: ActivityFilterState;
  workflows: readonly WorkflowOption[];
  workflowsLoading: boolean;
  onChange: (next: ActivityFilterState) => void;
}) {
  const s = useItemsStrings();
  const kinds: {
    value: ActivityKindFilter | typeof KIND_ALL;
    label: string;
  }[] = [
    { value: KIND_ALL, label: s.activity.kind.all },
    { value: "run", label: s.activity.kind.run },
    { value: "change", label: s.activity.kind.change },
    { value: "needs_you", label: s.activity.kind.needs_you },
  ];
  const whoOptions: FilterOption[] = [
    { value: "person", label: s.activity.who.person },
    { value: "agent", label: s.activity.who.agent },
    { value: "schedule", label: s.activity.who.schedule },
  ];
  const rangeOptions: { value: ActivityRange; label: string }[] = [
    { value: "day", label: s.activity.range.day },
    { value: "week", label: s.activity.range.week },
    { value: "month", label: s.activity.range.month },
    { value: "all", label: s.activity.range.all },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filters.kind ?? KIND_ALL}
        aria-label={s.activity.filterGroupLabel}
        onValueChange={(value) => {
          // An empty value is the active segment clicked again; one always stays on.
          const kind = parseKind(value);
          if (kind !== undefined) onChange({ ...filters, kind });
        }}
      >
        {kinds.map((kind) => (
          <ToggleGroupItem key={kind.value} value={kind.value}>
            {kind.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FilterSelect
        label={s.activity.workflowLabel}
        value={filters.workflowId}
        noneLabel={s.activity.allWorkflows}
        disabled={workflowsLoading}
        options={workflows.map((workflow) => ({
          value: workflow.id,
          label: workflow.name,
        }))}
        onChange={(workflowId) => onChange({ ...filters, workflowId })}
      />
      <FilterSelect
        label={s.activity.whoLabel}
        value={filters.who}
        noneLabel={s.activity.who.all}
        options={whoOptions}
        onChange={(who) =>
          onChange({ ...filters, who: who as ActivityWhoFilter | null })
        }
      />
      <FilterSelect
        label={s.activity.rangeLabel}
        value={filters.range}
        options={rangeOptions}
        onChange={(range) =>
          onChange({ ...filters, range: (range ?? "week") as ActivityRange })
        }
      />
    </div>
  );
}
