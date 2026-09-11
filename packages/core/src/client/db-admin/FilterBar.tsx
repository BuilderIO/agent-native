import { IconFilter, IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";

import type {
  DbAdminColumn,
  DbAdminFilter,
  DbAdminFilterOp,
} from "../../db-admin/types.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { cn } from "../utils.js";

const OPS: { value: DbAdminFilterOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "=", needsValue: true },
  { value: "neq", label: "≠", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "like", label: "like", needsValue: true },
  { value: "ilike", label: "ilike", needsValue: true },
  { value: "in", label: "in", needsValue: true },
  { value: "is_null", label: "is null", needsValue: false },
  { value: "not_null", label: "not null", needsValue: false },
];

function opNeedsValue(op: DbAdminFilterOp): boolean {
  return OPS.find((o) => o.value === op)?.needsValue ?? true;
}

function opLabel(op: DbAdminFilterOp): string {
  return OPS.find((o) => o.value === op)?.label ?? op;
}

const selectCls =
  "h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";
const inputCls =
  "h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";

export interface FilterBarProps {
  columns: DbAdminColumn[];
  filters: DbAdminFilter[];
  onChange: (filters: DbAdminFilter[]) => void;
}

export function FilterBar({ columns, filters, onChange }: FilterBarProps) {
  const removeAt = (i: number) =>
    onChange(filters.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f, i) => (
        <FilterChip
          key={`${f.column}-${f.op}-${i}`}
          filter={f}
          onRemove={() => removeAt(i)}
        />
      ))}
      <AddFilterPopover
        columns={columns}
        onAdd={(f) => onChange([...filters, f])}
      />
      {filters.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function FilterChip({
  filter,
  onRemove,
}: {
  filter: DbAdminFilter;
  onRemove: () => void;
}) {
  const valueText = opNeedsValue(filter.op)
    ? ` ${String(filter.value ?? "")}`
    : "";
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs">
      <span className="font-medium text-foreground">{filter.column}</span>
      <span className="text-muted-foreground">{opLabel(filter.op)}</span>
      {valueText && <span className="text-foreground">{valueText.trim()}</span>}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Remove filter"
      >
        <IconX className="h-3 w-3" />
      </button>
    </span>
  );
}

function AddFilterPopover({
  columns,
  onAdd,
}: {
  columns: DbAdminColumn[];
  onAdd: (f: DbAdminFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState(columns[0]?.name ?? "");
  const [op, setOp] = useState<DbAdminFilterOp>("eq");
  const [value, setValue] = useState("");

  const reset = () => {
    setColumn(columns[0]?.name ?? "");
    setOp("eq");
    setValue("");
  };

  const submit = () => {
    if (!column) return;
    const filter: DbAdminFilter = { column, op };
    if (opNeedsValue(op)) filter.value = value;
    onAdd(filter);
    reset();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-border hover:text-foreground"
        >
          <IconFilter className="h-3.5 w-3.5" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-[20rem] p-2">
        <div className="flex items-center gap-1.5">
          <select
            value={column}
            onChange={(e) => setColumn(e.target.value)}
            className={cn(selectCls, "max-w-[10rem] flex-1")}
          >
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as DbAdminFilterOp)}
            className={selectCls}
          >
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {opNeedsValue(op) && (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={op === "in" ? "a, b, c" : "value"}
              className={cn(inputCls, "flex-1")}
            />
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <IconPlus className="h-3.5 w-3.5" />
            Apply filter
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
