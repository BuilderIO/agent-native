import { useT } from "@agent-native/core/client/i18n";
import { IconPlus, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  LIST_OPERATORS,
  NO_VALUE_OPERATORS,
  operatorsFor,
  columnFilterType,
  defaultFilterOperator,
  type DisplayFilter,
  type FilterColumn,
} from "./display-filters";

export function DisplayFilterRows({
  columns,
  rows,
  filters,
  onChange,
  onAdd,
}: {
  columns: FilterColumn[];
  rows: unknown[][];
  filters: DisplayFilter[];
  onChange: (filters: DisplayFilter[]) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const update = (id: number, patch: Partial<DisplayFilter>) =>
    onChange(
      filters.map((filter) =>
        filter.id === id ? { ...filter, ...patch } : filter,
      ),
    );
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border p-2"
      aria-label={t("notebook.displayFilters.label")}
    >
      {filters.map((filter, index) => {
        const name = columns[filter.column]?.name ?? t("notebook.filterColumn");
        const type = columnFilterType(
          columns[filter.column] ?? { name },
          rows,
          filter.column,
        );
        const params = { index: index + 1, column: name };
        const list = LIST_OPERATORS.includes(filter.operator);
        const date = type === "date" || type === "datetime";
        return (
          <div
            className="flex max-w-full flex-wrap items-center gap-1"
            key={filter.id}
          >
            <Select
              value={String(filter.column)}
              onValueChange={(value) => {
                const column = Number(value);
                const nextType = columnFilterType(
                  columns[column] ?? { name },
                  rows,
                  column,
                );
                update(filter.id, {
                  column,
                  operator: defaultFilterOperator(nextType),
                  value: "",
                  end: "",
                  values: [],
                });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto"
                aria-label={t("notebook.displayFilters.column", params)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {column.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filter.operator}
              onValueChange={(value) => {
                const operator = operatorsFor(type).find(
                  (item) => item === value,
                );
                if (operator) update(filter.id, { operator });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto"
                aria-label={t("notebook.displayFilters.operator", params)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operatorsFor(type).map((operator) => (
                  <SelectItem key={operator} value={operator}>
                    {t(`notebook.displayFilters.operators.${operator}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {NO_VALUE_OPERATORS.includes(filter.operator) ? null : list ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="max-w-56 min-w-0"
                    aria-label={t("notebook.displayFilters.values", params)}
                    title={filter.values.join(", ") || undefined}
                  >
                    <span className="min-w-0 truncate">
                      {filter.values.length
                        ? filter.values.join(", ")
                        : t("notebook.displayFilters.chooseValues")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="max-h-64 w-auto overflow-y-auto p-2"
                  align="start"
                >
                  {[
                    ...new Set(
                      rows
                        .map((row) => row[filter.column])
                        .filter(
                          (value) => value !== null && value !== undefined,
                        )
                        .map(String),
                    ),
                  ]
                    .sort()
                    .map((value) => (
                      <label
                        className="flex items-center gap-2 p-1 text-sm"
                        key={value}
                      >
                        <Checkbox
                          checked={filter.values.includes(value)}
                          onCheckedChange={(checked) =>
                            update(filter.id, {
                              values:
                                checked === true
                                  ? [...filter.values, value]
                                  : filter.values.filter(
                                      (item) => item !== value,
                                    ),
                            })
                          }
                        />
                        {value}
                      </label>
                    ))}
                </PopoverContent>
              </Popover>
            ) : (
              <Input
                type={date ? "date" : type === "number" ? "number" : "text"}
                className="h-7 w-36 text-xs"
                aria-label={t("notebook.displayFilters.value", params)}
                placeholder={t("notebook.displayFilters.placeholder")}
                value={filter.value}
                onChange={(event) =>
                  update(filter.id, { value: event.target.value })
                }
              />
            )}
            {filter.operator === "between" ? (
              <Input
                type="date"
                className="h-7 w-36 text-xs"
                aria-label={t("notebook.displayFilters.end", params)}
                value={filter.end}
                onChange={(event) =>
                  update(filter.id, { end: event.target.value })
                }
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("notebook.displayFilters.remove", params)}
              onClick={() =>
                onChange(filters.filter((item) => item.id !== filter.id))
              }
            >
              <IconX size={12} />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("notebook.displayFilters.add")}
        onClick={onAdd}
      >
        <IconPlus size={12} />
      </Button>
    </div>
  );
}
