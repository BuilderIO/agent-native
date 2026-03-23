import { useEffect, useRef } from "react";
import { formatDate } from "./queries";

export interface PopoverRow {
  label: string;
  value: number;
}

export interface PopoverState {
  x: number;
  y: number;
  day: string;
  rows: PopoverRow[];
}

interface ChartPopoverProps {
  state: PopoverState | null;
  onClose: () => void;
  valueLabel?: string;
  /** Show one decimal place for values (e.g. credits) */
  decimal?: boolean;
}

export function ChartPopover({
  state,
  onClose,
  valueLabel = "PRs",
  decimal = false,
}: ChartPopoverProps) {
  const fmt = (v: number) =>
    decimal
      ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
      : v.toLocaleString();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state, onClose]);

  if (!state) return null;

  const total = state.rows.reduce((s, r) => s + r.value, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        ref={ref}
        className="bg-popover border border-border rounded-lg shadow-xl p-4 min-w-[280px] max-w-[380px] max-h-[400px] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">
            {formatDate(state.day)}
          </p>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm px-1.5 py-0.5 rounded hover:bg-accent"
          >
            &times;
          </button>
        </div>
        <div className="space-y-1.5">
          {state.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="text-muted-foreground truncate">
                {row.label}
              </span>
              <span className="text-foreground font-medium tabular-nums shrink-0">
                {fmt(row.value)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-border mt-3 pt-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total {valueLabel}</span>
          <span className="text-foreground font-semibold tabular-nums">
            {fmt(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
