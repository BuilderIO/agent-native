import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconFilterOff,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { resolveDefault, resolveFilterVars } from "./filter-vars";
import type { DashboardFilter } from "./types";

export { resolveFilterVars } from "./filter-vars";

export const FILTER_PARAM_PREFIX = "f_";

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
    }
  }
  return result;
}

interface DashboardFilterBarProps {
  filters: DashboardFilter[];
  onSaveView?: (name: string, filters: Record<string, string>) => void;
}

export function DashboardFilterBar({
  filters,
  onSaveView,
}: DashboardFilterBarProps) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
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

  const handleSaveView = useCallback(() => {
    if (!viewName.trim() || !onSaveView) return;
    const currentFilters = extractFilterParams(uniqueFilters, searchParams);
    onSaveView(viewName.trim(), currentFilters);
    setViewName("");
    setSaveDialogOpen(false);
  }, [viewName, onSaveView, uniqueFilters, searchParams]);

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

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("sqlDashboard.saveAsView")}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={t("sqlDashboard.viewNameRecentPlaceholder")}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveView()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveDialogOpen(false)}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSaveView}
              disabled={!viewName.trim()}
            >
              {t("explorer.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <div className="flex items-center gap-2">
          <DatePicker
            value={vars[startKey] || ""}
            onChange={(v) => setValue({ [startKey]: v })}
          />
          <span className="text-xs text-muted-foreground">
            {t("sqlDashboard.to")}
          </span>
          <DatePicker
            value={vars[endKey] || ""}
            onChange={(v) => setValue({ [endKey]: v })}
          />
        </div>
      </div>
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
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <Select
          value={current}
          onValueChange={(v) => setValue({ [filter.id]: v })}
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
          </SelectContent>
        </Select>
      </div>
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
