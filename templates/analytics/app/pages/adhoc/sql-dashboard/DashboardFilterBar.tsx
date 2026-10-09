import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconFilterOff,
} from "@tabler/icons-react";
import { useCallback, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MenuSearchInput } from "@/components/ui/command";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

import { DateRangeInput } from "../_shared/components/DateRangeInput";
import {
  FILTER_PARAM_PREFIX,
  isDateRangePresetFilter,
  MULTI_SELECT_EMPTY,
  resolveDefault,
  resolveFilterVars,
} from "./filter-vars";
import type { DashboardFilter } from "./types";

export { FILTER_PARAM_PREFIX, resolveFilterVars } from "./filter-vars";

/** Check if any filter param in the URL differs from the defaults */
function hasActiveFilters(
  filters: DashboardFilter[],
  searchParams: URLSearchParams,
): boolean {
  for (const f of filters) {
    if (f.type === "date-range") {
      if (searchParams.has(FILTER_PARAM_PREFIX + f.id + "Start")) return true;
      if (searchParams.has(FILTER_PARAM_PREFIX + f.id + "End")) return true;
    } else {
      if (
        isDateRangePresetFilter(f) &&
        (searchParams.has(FILTER_PARAM_PREFIX + f.id + "Start") ||
          searchParams.has(FILTER_PARAM_PREFIX + f.id + "End"))
      ) {
        return true;
      }
      if (searchParams.has(FILTER_PARAM_PREFIX + f.id)) return true;
    }
  }
  return false;
}

export function extractFilterParams(
  filters: DashboardFilter[],
  searchParams: URLSearchParams,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of filters) {
    if (f.type === "date-range") {
      const startKey = f.id + "Start";
      const endKey = f.id + "End";
      const sv = searchParams.get(FILTER_PARAM_PREFIX + startKey);
      const ev = searchParams.get(FILTER_PARAM_PREFIX + endKey);
      if (sv) result[FILTER_PARAM_PREFIX + startKey] = sv;
      if (ev) result[FILTER_PARAM_PREFIX + endKey] = ev;
    } else {
      const v = searchParams.get(FILTER_PARAM_PREFIX + f.id);
      if (v) result[FILTER_PARAM_PREFIX + f.id] = v;
      if (isDateRangePresetFilter(f)) {
        for (const key of [f.id + "Start", f.id + "End"]) {
          const value = searchParams.get(FILTER_PARAM_PREFIX + key);
          if (value) result[FILTER_PARAM_PREFIX + key] = value;
        }
      }
    }
  }
  return result;
}

interface DashboardFilterBarProps {
  filters: DashboardFilter[];
  onSaveView?: (
    name: string,
    filters: Record<string, string>,
    isDefault: boolean,
  ) => void | Promise<void>;
}

export function DashboardFilterBar({
  filters,
  onSaveView,
}: DashboardFilterBarProps) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const defaultCheckboxId = useId();
  const [filtersOpen, setFiltersOpen] = useState(true);
  const uniqueFilters = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const unique: DashboardFilter[] = [];
    for (const filter of filters) {
      if (seen.has(filter.id)) {
        duplicates.add(filter.id);
        continue;
      }
      seen.add(filter.id);
      unique.push(filter);
    }
    if (duplicates.size > 0) {
      console.warn(
        `[DashboardFilterBar] Skipped duplicate filter ids: ${Array.from(duplicates).join(", ")}`,
      );
    }
    return unique;
  }, [filters]);

  const getParam = useCallback(
    (key: string) => searchParams.get(FILTER_PARAM_PREFIX + key) ?? "",
    [searchParams],
  );

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          const param = FILTER_PARAM_PREFIX + key;
          if (value) next.set(param, value);
          else next.delete(param);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const keysToRemove: string[] = [];
      next.forEach((_, k) => {
        if (k.startsWith(FILTER_PARAM_PREFIX)) keysToRemove.push(k);
      });
      keysToRemove.forEach((k) => next.delete(k));
      next.delete("view");
      return next;
    });
  }, [setSearchParams]);

  const handleSaveView = useCallback(async () => {
    if (!viewName.trim() || !onSaveView || savingView) return;
    setSavingView(true);
    try {
      const currentFilters = extractFilterParams(uniqueFilters, searchParams);
      await onSaveView(viewName.trim(), currentFilters, setAsDefault);
      setViewName("");
      setSetAsDefault(false);
      setSaveDialogOpen(false);
    } catch (error) {
      toast.error(
        t("sqlDashboard.saveViewFailedWithMessage", {
          message:
            error instanceof Error
              ? error.message
              : t("sqlDashboard.saveViewFailed"),
        }),
      );
    } finally {
      setSavingView(false);
    }
  }, [
    viewName,
    onSaveView,
    savingView,
    uniqueFilters,
    searchParams,
    setAsDefault,
    t,
  ]);

  const vars = useMemo(
    () => resolveFilterVars(uniqueFilters, getParam),
    [uniqueFilters, getParam],
  );

  const filtersActive = hasActiveFilters(uniqueFilters, searchParams);

  return (
    <>
      <Collapsible
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        className="group rounded-lg bg-card px-3 py-2"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <span className="self-center text-xs font-medium text-muted-foreground group-data-[state=open]:hidden">
            {t("sqlDashboard.filters")}
          </span>
          <CollapsibleContent className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-3 items-end">
              {uniqueFilters.map((f) => (
                <FilterControl
                  key={f.id}
                  filter={f}
                  vars={vars}
                  hasParam={(key) =>
                    searchParams.has(FILTER_PARAM_PREFIX + key)
                  }
                  setValue={(updates) => setParam(updates)}
                />
              ))}
            </div>
          </CollapsibleContent>
          <div className="flex shrink-0 items-center gap-1 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-data-[state=closed]:opacity-100">
            {onSaveView && filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-primary"
                onClick={() => setSaveDialogOpen(true)}
              >
                <IconDeviceFloppy className="h-3 w-3 mr-1" />
                {t("sqlDashboard.saveView")}
              </Button>
            )}
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearAllFilters}
              >
                <IconFilterOff className="h-3 w-3 mr-1" />
                {t("sqlDashboard.clearAll")}
              </Button>
            )}
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label={
                  filtersOpen
                    ? t("sqlDashboard.collapseFilters")
                    : t("sqlDashboard.expandFilters")
                }
              >
                {filtersOpen ? t("sqlDashboard.hide") : t("sqlDashboard.show")}
                <IconChevronDown
                  className={cn(
                    "ml-1 h-3 w-3 transition-transform",
                    filtersOpen && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
      </Collapsible>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) {
            setViewName("");
            setSetAsDefault(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("sqlDashboard.saveAsView")}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={t("sqlDashboard.viewNameRecentPlaceholder")}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSaveView()}
              autoFocus
            />
            <label
              htmlFor={defaultCheckboxId}
              className="mt-3 flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                id={defaultCheckboxId}
                checked={setAsDefault}
                onCheckedChange={(checked) => setSetAsDefault(checked === true)}
              />
              <span>{t("sqlDashboard.setAsDefault")}</span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveDialogOpen(false);
                setViewName("");
                setSetAsDefault(false);
              }}
              disabled={savingView}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveView()}
              disabled={!viewName.trim() || savingView}
            >
              {savingView ? t("sqlDashboard.saving") : t("explorer.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MultiSelectOption({
  label,
  checked,
  onCheckedChange,
  onOnly,
  onlyLabel,
  onlyAriaLabel,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onOnly: () => void;
  onlyLabel: string;
  onlyAriaLabel: string;
}) {
  const id = useId();
  return (
    <li className="group/option flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate">
        {label}
      </label>
      <span className="inline-flex sm:hidden sm:group-hover/option:inline-flex sm:group-focus-within/option:inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onOnly}
          aria-label={onlyAriaLabel}
        >
          {onlyLabel}
        </Button>
      </span>
    </li>
  );
}

function MultiSelectFilter({
  filter,
  value,
  setValue,
}: {
  filter: DashboardFilter;
  value: string;
  setValue: (updates: Record<string, string>) => void;
}) {
  const t = useT();
  const labelId = useId();
  const triggerId = useId();
  const optionsListId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = filter.options ?? [];
  // Values are comma-joined in the URL, so option values must not contain ",".
  const selected = value.split(",").filter(Boolean);
  const selectedSet = new Set(selected);
  const allOptionsSelected =
    options.length > 0 &&
    selectedSet.size === options.length &&
    options.every((option) => selectedSet.has(option.value));
  // Keep URL values with no matching option visible so the trigger never says "All" over a filtered query.
  const selectedLabels = selected.map(
    (selectedValue) =>
      options.find((option) => option.value === selectedValue)?.label ??
      selectedValue,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(normalizedQuery) ||
          option.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : options;
  const allFilteredOptionsSelected =
    filteredOptions.length > 0 &&
    filteredOptions.every((option) => selectedSet.has(option.value));

  const setSelected = (next: string[]) =>
    setValue({
      [filter.id]: next.length > 0 ? next.join(",") : MULTI_SELECT_EMPTY,
    });
  const selectAllFiltered = () => {
    const filteredValues = new Set(
      filteredOptions.map((option) => option.value),
    );
    setSelected(
      options
        .filter(
          (option) =>
            selectedSet.has(option.value) || filteredValues.has(option.value),
        )
        .map((option) => option.value),
    );
  };
  const toggle = (optionValue: string, checked: boolean) =>
    setSelected(
      options
        .filter((option) =>
          option.value === optionValue
            ? checked
            : selectedSet.has(option.value),
        )
        .map((option) => option.value),
    );

  return (
    <div className="flex flex-col gap-1">
      <label id={labelId} className="text-xs text-muted-foreground font-medium">
        {filter.label}
      </label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            aria-labelledby={`${labelId} ${triggerId}`}
            variant="outline"
            size="sm"
            className="w-40 justify-start"
          >
            <span className="min-w-0 truncate">
              {allOptionsSelected
                ? t("sqlDashboard.allValues")
                : selectedLabels.length > 0
                  ? selectedLabels.join(", ")
                  : t("sqlDashboard.allValues")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <MenuSearchInput
            aria-controls={optionsListId}
            aria-label={t("sqlDashboard.searchValues")}
            placeholder={t("sqlDashboard.searchValues")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={allFilteredOptionsSelected}
              onClick={selectAllFiltered}
            >
              {t("sqlDashboard.selectAll")}
            </Button>
            {selected.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="w-full justify-start"
                onClick={() => setSelected([])}
              >
                {t("sqlDashboard.clearAll")}
              </Button>
            )}
          </div>
          <ul
            id={optionsListId}
            aria-label={filter.label}
            className="max-h-60 list-none overflow-y-auto p-1"
          >
            {filteredOptions.map((option) => (
              <MultiSelectOption
                key={option.value}
                label={option.label}
                checked={selectedSet.has(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked)}
                onOnly={() => setSelected([option.value])}
                onlyLabel={t("sqlDashboard.selectOnly")}
                onlyAriaLabel={t("sqlDashboard.selectOnlyValue", {
                  value: option.label,
                })}
              />
            ))}
            {filteredOptions.length === 0 && (
              <li
                role="status"
                className="px-2 py-4 text-center text-xs text-muted-foreground"
              >
                {t("sqlDashboard.noValuesFound")}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface FilterControlProps {
  filter: DashboardFilter;
  vars: Record<string, string>;
  hasParam: (key: string) => boolean;
  setValue: (updates: Record<string, string>) => void;
}

function FilterControl({
  filter,
  vars,
  hasParam,
  setValue,
}: FilterControlProps) {
  const t = useT();
  if (filter.type === "date-range") {
    const startKey = `${filter.id}Start`;
    const endKey = `${filter.id}End`;
    return (
      <DateRangeInput
        label={filter.label}
        startDate={vars[startKey] || ""}
        endDate={vars[endKey] || ""}
        onStartChange={(v) => setValue({ [startKey]: v })}
        onEndChange={(v) => setValue({ [endKey]: v })}
      />
    );
  }

  if (filter.type === "date") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <DatePicker
          value={vars[filter.id] || ""}
          onChange={(v) => setValue({ [filter.id]: v })}
        />
      </div>
    );
  }

  if (filter.type === "select") {
    const current =
      vars[filter.id] || resolveDefault(filter.default, filter.type);
    const supportsCustomRange = isDateRangePresetFilter(filter);
    const startKey = filter.id + "Start";
    const endKey = filter.id + "End";
    const selectControl = (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <Select
          value={current}
          onValueChange={(v) =>
            setValue({
              [filter.id]: v,
              ...(supportsCustomRange
                ? {
                    [startKey]: v === "custom" ? vars[startKey] || "" : "",
                    [endKey]: v === "custom" ? vars[endKey] || "" : "",
                  }
                : {}),
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-[140px] justify-start gap-2 text-xs"
          >
            <SelectValue className="min-w-0 flex-1 text-left" />
          </SelectTrigger>
          <SelectContent>
            {filter.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
            {supportsCustomRange &&
              !filter.options?.some((option) => option.value === "custom") && (
                <SelectItem value="custom" className="text-xs">
                  {t("sqlDashboard.customRange")}
                </SelectItem>
              )}
          </SelectContent>
        </Select>
      </div>
    );
    if (supportsCustomRange && current === "custom") {
      return (
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          {selectControl}
          <DateRangeInput
            label={t("sqlDashboard.customRange")}
            startDate={vars[startKey] || ""}
            endDate={vars[endKey] || ""}
            onStartChange={(v) => setValue({ [startKey]: v })}
            onEndChange={(v) => setValue({ [endKey]: v })}
            className="shrink-0"
          />
        </div>
      );
    }
    return selectControl;
  }

  if (filter.type === "multi-select") {
    return (
      <MultiSelectFilter
        filter={filter}
        value={vars[filter.id] || ""}
        setValue={setValue}
      />
    );
  }

  if (filter.type === "toggle") {
    const active = hasParam(filter.id) && !!vars[filter.id];
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <Button
          variant={active ? "default" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setValue({ [filter.id]: active ? "" : "true" })}
        >
          {active ? t("sqlDashboard.on") : t("sqlDashboard.off")}
        </Button>
      </div>
    );
  }

  if (filter.type === "toggle-date") {
    const active = hasParam(filter.id);
    const current = active ? vars[filter.id] || "" : "";
    return (
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">
            {filter.label}
          </label>
          <Button
            variant={active ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() =>
              setValue({
                [filter.id]: active
                  ? ""
                  : resolveDefault(filter.default, filter.type),
              })
            }
          >
            {active ? t("sqlDashboard.on") : t("sqlDashboard.off")}
          </Button>
        </div>
        {active && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              {t("sqlDashboard.since")}
            </label>
            <DatePicker
              value={current}
              onChange={(v) => setValue({ [filter.id]: v })}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">
        {filter.label}
      </label>
      <Input
        size="sm"
        value={vars[filter.id] || ""}
        onChange={(e) => setValue({ [filter.id]: e.target.value })}
        className="w-[160px] text-xs"
      />
    </div>
  );
}
