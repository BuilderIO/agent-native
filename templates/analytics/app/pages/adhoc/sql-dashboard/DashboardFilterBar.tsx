import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconFilterOff,
  IconPlus,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  MAX_FILTER_PRESETS,
  MULTI_SELECT_EMPTY,
  resolveDefault,
  resolveFilterVars,
  usableFilterPresets,
} from "./filter-vars";
import type { DashboardFilter, FilterPreset } from "./types";

export { FILTER_PARAM_PREFIX, resolveFilterVars } from "./filter-vars";

export interface DashboardSavedView {
  id: string;
  filters: Record<string, string>;
  isDefault?: boolean;
}

// Reset returns to the saved view open in the URL (filter edits keep `view`), so
// editing a view and resetting lands back on it. With no view open it goes where
// a fresh load does: the default view, otherwise each filter's own default.
export function resetTargetView(
  views: readonly DashboardSavedView[],
  searchParams: URLSearchParams,
): DashboardSavedView | undefined {
  const viewId = searchParams.get("view");
  return (
    views.find((view) => view.id === viewId) ??
    views.find((view) => view.isDefault)
  );
}

const NO_VIEWS: readonly DashboardSavedView[] = [];

// Compare resolved values, not param presence: a URL that spells out a default
// (f_timeRange=30d) still matches.
export function filtersMatchView(
  filters: DashboardFilter[],
  searchParams: URLSearchParams,
  view: DashboardSavedView | undefined,
): boolean {
  const current = resolveFilterVars(
    filters,
    (key) => searchParams.get(FILTER_PARAM_PREFIX + key) ?? "",
  );
  const target = resolveFilterVars(
    filters,
    (key) => view?.filters[FILTER_PARAM_PREFIX + key] ?? "",
  );
  return Object.keys(target).every((key) => current[key] === target[key]);
}

export function resetFilterParams(
  prev: URLSearchParams,
  view: DashboardSavedView | undefined,
): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const key of Array.from(next.keys())) {
    if (key.startsWith(FILTER_PARAM_PREFIX)) next.delete(key);
  }
  if (view) {
    for (const [key, value] of Object.entries(view.filters)) {
      if (value) next.set(key, value);
    }
    next.set("view", view.id);
  } else {
    next.delete("view");
  }
  return next;
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
  // null while the saved views load or after they fail: Reset cannot know its target, so it stays hidden.
  views?: readonly DashboardSavedView[] | null;
  onSaveView?: (
    name: string,
    filters: Record<string, string>,
    isDefault: boolean,
  ) => void | Promise<void>;
  // Passed only in edit mode: a preset changes the dashboard for everyone who
  // can see it, so view mode never offers one.
  onSavePreset?: (filterId: string, preset: FilterPreset) => void;
  shared?: boolean;
}

export function DashboardFilterBar({
  filters,
  views = NO_VIEWS,
  onSaveView,
  onSavePreset,
  shared = false,
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

  const resetFilters = useCallback(() => {
    if (!views) return;
    setSearchParams((prev) =>
      resetFilterParams(prev, resetTargetView(views, prev)),
    );
  }, [views, setSearchParams]);

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

  const canReset =
    views !== null &&
    !filtersMatchView(
      uniqueFilters,
      searchParams,
      resetTargetView(views, searchParams),
    );
  const filtersChanged = !filtersMatchView(
    uniqueFilters,
    searchParams,
    views?.find((view) => view.isDefault),
  );

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
                  onSavePreset={
                    onSavePreset && ((preset) => onSavePreset(f.id, preset))
                  }
                  shared={shared}
                />
              ))}
            </div>
          </CollapsibleContent>
          <div className="flex shrink-0 items-center gap-1 self-center">
            <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-data-[state=closed]:opacity-100">
              {onSaveView && filtersChanged && (
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
                  {filtersOpen
                    ? t("sqlDashboard.hide")
                    : t("sqlDashboard.show")}
                  <IconChevronDown
                    className={cn(
                      "ml-1 h-3 w-3 transition-transform",
                      filtersOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            {/* Outside the hover group on purpose: hidden until hover, people missed it. */}
            {canReset && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={resetFilters}
              >
                <IconFilterOff className="h-3 w-3 mr-1" />
                {t("sqlDashboard.resetFilters")}
              </Button>
            )}
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
      <span className="inline-flex">
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
  onSavePreset,
  shared,
}: {
  filter: DashboardFilter;
  value: string;
  setValue: (updates: Record<string, string>) => void;
  onSavePreset?: (preset: FilterPreset) => void;
  shared: boolean;
}) {
  const t = useT();
  const labelId = useId();
  const triggerId = useId();
  const optionsListId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState("");
  const saveAsGroupRef = useRef<HTMLButtonElement>(null);
  const refocusSaveAsGroupRef = useRef(false);
  useEffect(() => {
    if (naming || !refocusSaveAsGroupRef.current) return;
    refocusSaveAsGroupRef.current = false;
    saveAsGroupRef.current?.focus();
  }, [naming]);
  // A save unmounts the name form, and a rejected save then unmounts the group
  // it showed. Until the dropdown closes, focus that falls to the page goes to
  // the saved group, or back to Save as group once that group is gone.
  const savedPresetLabelRef = useRef<string | null>(null);
  const focusIfLost = (button: HTMLButtonElement | null) => {
    if (button && document.activeElement === document.body) button.focus();
  };
  const seenOptionValues = new Set<string>();
  const options = (filter.options ?? []).filter((option) => {
    if (seenOptionValues.has(option.value)) return false;
    seenOptionValues.add(option.value);
    return true;
  });
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
  const presets = usableFilterPresets(filter.presets, seenOptionValues);
  const presetSelected = (preset: FilterPreset) =>
    new Set(preset.values).size === selectedSet.size &&
    preset.values.every((presetValue) => selectedSet.has(presetValue));
  const selectedPreset = presets.find(presetSelected);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(normalizedQuery) ||
          option.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : options;
  const noFilteredOptions = filteredOptions.length === 0;
  const allFilteredOptionsSelected =
    !noFilteredOptions &&
    filteredOptions.every((option) => selectedSet.has(option.value));

  const setSelected = (next: string[]) =>
    setValue({
      [filter.id]: next.length > 0 ? next.join(",") : MULTI_SELECT_EMPTY,
    });
  const selectAllFiltered = () =>
    setSelected(
      Array.from(
        new Set([
          ...selected,
          ...filteredOptions.map((option) => option.value),
        ]),
      ),
    );
  const applyPreset = (preset: FilterPreset) => {
    setSelected(Array.from(new Set(preset.values)));
    setOpen(false);
    setQuery("");
  };
  const toggle = (optionValue: string, checked: boolean) =>
    setSelected(
      checked
        ? Array.from(new Set([...selected, optionValue]))
        : selected.filter((value) => value !== optionValue),
    );

  // A save rejects a value with no option, so a URL-only value rules a group out.
  const canSaveGroup =
    onSavePreset !== undefined &&
    presets.length < MAX_FILTER_PRESETS &&
    !normalizedQuery &&
    selectedSet.size >= 2 &&
    !allOptionsSelected &&
    !selectedPreset &&
    selected.every((selectedValue) => seenOptionValues.has(selectedValue));
  const trimmedGroupName = groupName.trim();
  const groupNameTaken = presets.some(
    (preset) => preset.label === trimmedGroupName,
  );
  const stopNaming = () => {
    setNaming(false);
    setGroupName("");
  };
  const saveGroup = () => {
    if (!onSavePreset || !trimmedGroupName || groupNameTaken) return;
    savedPresetLabelRef.current = trimmedGroupName;
    onSavePreset({
      label: trimmedGroupName,
      values: options
        .filter((option) => selectedSet.has(option.value))
        .map((option) => option.value),
    });
    stopNaming();
  };

  return (
    <div className="flex flex-col gap-1">
      <label id={labelId} className="text-xs text-muted-foreground font-medium">
        {filter.label}
      </label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) return;
          savedPresetLabelRef.current = null;
          setQuery("");
          stopNaming();
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
                : selectedPreset
                  ? selectedPreset.label
                  : selectedLabels.length > 0
                    ? selectedLabels.join(", ")
                    : t("sqlDashboard.allValues")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          // Room for Select all, a preset and Clear all on one row.
          className={presets.length > 0 ? "w-72" : "w-64"}
          onEscapeKeyDown={(event) => {
            if (!naming) return;
            // Escape in the name field backs out of naming, not the dropdown.
            event.preventDefault();
            refocusSaveAsGroupRef.current = true;
            stopNaming();
          }}
        >
          <MenuSearchInput
            aria-controls={optionsListId}
            aria-label={t("sqlDashboard.searchValues")}
            placeholder={t("sqlDashboard.searchValues")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {/* Presets wrap inside their own column, so Select all and Clear all
              keep their places on the first line however many groups exist. */}
          <div className="flex items-start gap-1 border-b px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0"
              disabled={noFilteredOptions || allFilteredOptionsSelected}
              onClick={selectAllFiltered}
            >
              {t("sqlDashboard.selectAll")}
            </Button>
            {presets.length > 0 && !normalizedQuery && (
              <div
                role="group"
                aria-label={t("sqlDashboard.presets")}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
              >
                {presets.map((preset) => {
                  const active = presetSelected(preset);
                  return (
                    <Button
                      key={preset.label}
                      ref={(button) => {
                        if (savedPresetLabelRef.current === preset.label) {
                          focusIfLost(button);
                        }
                      }}
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-pressed={active}
                      className={cn(
                        "min-w-0 max-w-full",
                        active && "bg-accent",
                      )}
                      onClick={() => applyPreset(preset)}
                    >
                      {active && <IconCheck />}
                      <span className="min-w-0 truncate">{preset.label}</span>
                    </Button>
                  );
                })}
              </div>
            )}
            {selected.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto shrink-0"
                onClick={() => setSelected([])}
              >
                {t("sqlDashboard.clearAll")}
              </Button>
            )}
          </div>
          <div id={optionsListId}>
            {!noFilteredOptions && (
              <ul
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
              </ul>
            )}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                noFilteredOptions
                  ? "px-2 py-4 text-center text-xs text-muted-foreground"
                  : "sr-only"
              }
            >
              {noFilteredOptions ? t("sqlDashboard.noValuesFound") : ""}
            </div>
          </div>
          {canSaveGroup && (
            <div className="border-t p-1">
              {naming ? (
                <form
                  className="flex flex-col gap-1 p-0.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGroup();
                  }}
                >
                  {/* The name gets the full width: beside "Save for everyone"
                      (longer still in most locales) it would scroll out of view. */}
                  <Input
                    size="sm"
                    autoFocus
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder={t("sqlDashboard.groupName")}
                    aria-label={t("sqlDashboard.groupName")}
                    aria-invalid={groupNameTaken}
                  />
                  {groupNameTaken && (
                    <p role="alert" className="px-1 text-xs text-destructive">
                      {t("sqlDashboard.groupNameTaken")}
                    </p>
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    className="self-end"
                    disabled={!trimmedGroupName || groupNameTaken}
                  >
                    {shared
                      ? t("sqlDashboard.saveForEveryone")
                      : t("explorer.save")}
                  </Button>
                </form>
              ) : (
                <Button
                  ref={(button) => {
                    saveAsGroupRef.current = button;
                    if (savedPresetLabelRef.current !== null) {
                      focusIfLost(button);
                    }
                  }}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setNaming(true)}
                >
                  <IconPlus />
                  {t("sqlDashboard.saveAsGroup")}
                </Button>
              )}
            </div>
          )}
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
  onSavePreset?: (preset: FilterPreset) => void;
  shared: boolean;
}

function FilterControl({
  filter,
  vars,
  hasParam,
  setValue,
  onSavePreset,
  shared,
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
        onSavePreset={onSavePreset}
        shared={shared}
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
