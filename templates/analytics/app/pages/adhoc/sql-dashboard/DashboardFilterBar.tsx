import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { IconFilterOff, IconDeviceFloppy } from "@tabler/icons-react";
import type { DashboardFilter } from "./types";

export const FILTER_PARAM_PREFIX = "f_";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a filter's "default" string. Supports literal values, plus shorthand
 * tokens "Nd" (N days ago) and "today" used by date / date-range / toggle-date filters.
 */
function resolveDefault(raw: string | undefined): string {
  if (!raw) return "";
  const m = /^(\d+)d$/.exec(raw);
  if (m) return daysAgo(parseInt(m[1], 10));
  if (raw === "today") return daysAgo(0);
  return raw;
}

export function resolveFilterVars(
  filters: DashboardFilter[],
  getParam: (key: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) {
    if (f.type === "date-range") {
      const startKey = `${f.id}Start`;
      const endKey = `${f.id}End`;
      out[startKey] = getParam(startKey) || resolveDefault(f.default);
      out[endKey] = getParam(endKey) || daysAgo(0);
    } else if (f.type === "toggle" || f.type === "toggle-date") {
      // Toggles have no "off value" default — if the user hasn't opted in
      // via the URL, the SQL-side conditional block ({{?id}}...{{/id}})
      // must see an empty value so it doesn't emit. Otherwise the filter
      // looks "off" in the UI but still filters the data.
      out[f.id] = getParam(f.id);
    } else {
      const v = getParam(f.id);
      out[f.id] = v || resolveDefault(f.default);
    }
  }
  return out;
}

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

/** Extract current filter params from URL search params */
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

/**
 * Reads/writes filter state to URL search params under f_<id> keys, renders the
 * filter inputs, and emits a `vars` dict (suitable for SQL interpolation) to the
 * parent. Date-range filters emit `<id>Start` and `<id>End` keys.
 */
export function DashboardFilterBar({
  filters,
  onSaveView,
}: DashboardFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const getParam = useCallback(
    (key: string) => searchParams.get(FILTER_PARAM_PREFIX + key) ?? "",
    [searchParams],
  );

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            const param = FILTER_PARAM_PREFIX + key;
            if (value) next.set(param, value);
            else next.delete(param);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        // Remove all f_ prefixed params
        const keysToRemove: string[] = [];
        next.forEach((_, k) => {
          if (k.startsWith(FILTER_PARAM_PREFIX)) keysToRemove.push(k);
        });
        keysToRemove.forEach((k) => next.delete(k));
        // Also remove the view param since we're clearing
        next.delete("view");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleSaveView = useCallback(() => {
    if (!viewName.trim() || !onSaveView) return;
    const currentFilters = extractFilterParams(filters, searchParams);
    onSaveView(viewName.trim(), currentFilters);
    setViewName("");
    setSaveDialogOpen(false);
  }, [viewName, onSaveView, filters, searchParams]);

  // Compute the live vars dict (URL value or default) for every filter.
  const vars = useMemo(
    () => resolveFilterVars(filters, getParam),
    [filters, getParam],
  );

  const filtersActive = hasActiveFilters(filters, searchParams);

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Filters
          </h3>
          <div className="flex items-center gap-1">
            {onSaveView && filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-primary"
                onClick={() => setSaveDialogOpen(true)}
              >
                <IconDeviceFloppy className="h-3 w-3 mr-1" />
                Save view
              </Button>
            )}
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={clearAllFilters}
              >
                <IconFilterOff className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {filters.map((f) => (
            <FilterControl
              key={f.id}
              filter={f}
              vars={vars}
              hasParam={(key) => searchParams.has(FILTER_PARAM_PREFIX + key)}
              setValue={(updates) => setParam(updates)}
            />
          ))}
        </div>
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save as View</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="View name (e.g. 'Recent articles only')"
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
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveView}
              disabled={!viewName.trim()}
            >
              Save
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
  /** True when the user has an explicit value in the URL for this key.
   *  Distinct from `vars[key]`, which falls back to the resolved default —
   *  toggle filters need to check "is the URL param set" to render On/Off
   *  state correctly, not "does a resolved value exist". */
  hasParam: (key: string) => boolean;
  setValue: (updates: Record<string, string>) => void;
}

function FilterControl({
  filter,
  vars,
  hasParam,
  setValue,
}: FilterControlProps) {
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
          <span className="text-xs text-muted-foreground">to</span>
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
    const current = vars[filter.id] || resolveDefault(filter.default);
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          {filter.label}
        </label>
        <Select
          value={current}
          onValueChange={(v) => setValue({ [filter.id]: v })}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
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
          className="text-xs h-8 px-3"
          onClick={() => setValue({ [filter.id]: active ? "" : "true" })}
        >
          {active ? "On" : "Off"}
        </Button>
      </div>
    );
  }

  if (filter.type === "toggle-date") {
    // The toggle reflects whether the user has an explicit URL param, not
    // whether a default would resolve to a value. Otherwise a filter with
    // default "30d" would appear stuck in the "On" state forever.
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
            className="text-xs h-8 px-3"
            onClick={() =>
              setValue({
                [filter.id]: active ? "" : resolveDefault(filter.default),
              })
            }
          >
            {active ? "On" : "Off"}
          </Button>
        </div>
        {active && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Since
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

  // text
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">
        {filter.label}
      </label>
      <Input
        value={vars[filter.id] || ""}
        onChange={(e) => setValue({ [filter.id]: e.target.value })}
        className="h-8 w-[160px] text-xs"
      />
    </div>
  );
}
