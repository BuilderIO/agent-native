import { useCallback, useMemo } from "react";
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
    } else {
      const v = getParam(f.id);
      out[f.id] = v || resolveDefault(f.default);
    }
  }
  return out;
}

interface DashboardFilterBarProps {
  filters: DashboardFilter[];
}

/**
 * Reads/writes filter state to URL search params under f_<id> keys, renders the
 * filter inputs, and emits a `vars` dict (suitable for SQL interpolation) to the
 * parent. Date-range filters emit `<id>Start` and `<id>End` keys.
 */
export function DashboardFilterBar({ filters }: DashboardFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Compute the live vars dict (URL value or default) for every filter.
  const vars = useMemo(
    () => resolveFilterVars(filters, getParam),
    [filters, getParam],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Filters
      </h3>
      <div className="flex flex-wrap gap-3 items-end">
        {filters.map((f) => (
          <FilterControl
            key={f.id}
            filter={f}
            vars={vars}
            setValue={(updates) => setParam(updates)}
          />
        ))}
      </div>
    </div>
  );
}

interface FilterControlProps {
  filter: DashboardFilter;
  vars: Record<string, string>;
  setValue: (updates: Record<string, string>) => void;
}

function FilterControl({ filter, vars, setValue }: FilterControlProps) {
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
    const active = !!vars[filter.id];
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
    const current = vars[filter.id] || "";
    const active = !!current;
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
