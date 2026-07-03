import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "./utils.js";

export type VisualControlValue = string | number | boolean;

export interface VisualControlOption {
  label: string;
  value: string;
  color?: string;
}

export interface VisualTweakDefinition {
  id: string;
  label: string;
  type: "color-swatch" | "color-swatches" | "segment" | "slider" | "toggle";
  options?: VisualControlOption[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: VisualControlValue;
  cssVar?: string;
  unit?: string;
}

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

function formatNumber(value: number, unit?: string) {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
  return unit ? `${rounded}${unit}` : String(rounded);
}

function parseDraftNumber(value: string, fallback: number) {
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const next = Number(match[0]);
  return Number.isFinite(next) ? next : fallback;
}

export function VisualInspectorPanel({
  title,
  subtitle,
  children,
  className,
  headerAction,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "w-64 overflow-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-2xl shadow-black/35 backdrop-blur",
        className,
      )}
    >
      <div className="flex min-h-10 items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-[12px] text-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {headerAction}
      </div>
      <div className="max-h-[min(680px,calc(100vh-7rem))] overflow-y-auto p-2">
        {children}
      </div>
    </aside>
  );
}

export function VisualInspectorSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg px-1.5 py-2", className)}>
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/75">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function VisualControlRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function VisualSwatchControl({
  options,
  value,
  onChange,
  columns = 8,
  className,
}: {
  options: VisualControlOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const swatch = option.color ?? option.value;
        const isTransparent = swatch === "transparent";
        return (
          <button
            key={`${option.value}-${option.label}`}
            type="button"
            title={option.label}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "size-5 cursor-pointer rounded-md border border-border/70 transition-all hover:scale-105 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === option.value &&
                "border-foreground/70 ring-2 ring-foreground/40 ring-offset-1 ring-offset-card",
            )}
            style={{
              background: isTransparent
                ? "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)"
                : swatch,
              backgroundPosition: isTransparent
                ? "0 0, 0 4px, 4px -4px, -4px 0"
                : undefined,
              backgroundSize: isTransparent ? "8px 8px" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

export function VisualSegmentedControl({
  options,
  value,
  onChange,
  className,
}: {
  options: VisualControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 overflow-hidden rounded-md border border-border bg-background/60",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 flex-1 cursor-pointer px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground",
            value === option.value && "bg-accent text-foreground",
          )}
        >
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function VisualToggleControl({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 cursor-pointer rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary/35" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-foreground shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function VisualSliderControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const safeValue = clampNumber(Number.isFinite(value) ? value : min, min, max);
  return (
    <div className="flex h-7 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="min-w-0 flex-1 cursor-pointer accent-foreground"
      />
      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(safeValue, unit)}
      </span>
    </div>
  );
}

export function VisualScrubInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => formatNumber(value, unit));
  const [focused, setFocused] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    prevX: number;
    dragged: boolean;
  } | null>(null);

  useEffect(() => {
    if (!focused) setDraft(formatNumber(value, unit));
  }, [focused, unit, value]);

  const commit = (nextDraft = draft) => {
    const parsed = parseDraftNumber(nextDraft, value);
    const next = clampNumber(parsed, min, max);
    onChange(next);
    setDraft(formatNumber(next, unit));
  };

  const setNext = (next: number) => {
    const clamped = clampNumber(next, min, max);
    onChange(clamped);
    setDraft(formatNumber(clamped, unit));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatNumber(value, unit));
      event.currentTarget.blur();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const mult =
        event.shiftKey || event.metaKey ? 10 : event.altKey ? 0.1 : 1;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const base = parseDraftNumber(draft, value);
      setNext(base + direction * step * mult);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLLabelElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      prevX: event.clientX,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.prevX;
    if (delta === 0) return;
    drag.prevX = event.clientX;
    drag.dragged = true;
    const mult = event.shiftKey || event.metaKey ? 10 : event.altKey ? 0.1 : 1;
    setNext(value + delta * step * mult);
  };

  const onPointerUp = (event: PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (!drag.dragged) {
      document.getElementById(id)?.focus();
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "flex w-8 shrink-0 cursor-ew-resize select-none items-center justify-center rounded border border-transparent px-1 text-[10px] font-semibold text-muted-foreground hover:border-border hover:bg-accent/60",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {label}
      </label>
      <input
        id={id}
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/70 px-2 text-right text-[11px] tabular-nums text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
    </div>
  );
}

export function VisualTweakControl({
  tweak,
  value,
  onChange,
  className,
}: {
  tweak: VisualTweakDefinition;
  value: VisualControlValue;
  onChange: (value: VisualControlValue) => void;
  className?: string;
}) {
  if (tweak.type === "toggle") {
    return (
      <div
        className={cn("flex h-7 items-center justify-between gap-2", className)}
      >
        <span className="truncate text-[11px] text-muted-foreground">
          {tweak.label}
        </span>
        <VisualToggleControl
          checked={Boolean(value)}
          onChange={onChange}
          label={tweak.label}
        />
      </div>
    );
  }

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number(tweak.defaultValue);

  return (
    <VisualControlRow label={tweak.label} className={className}>
      {((tweak.type as string) === "color-swatch" ||
        (tweak.type as string) === "color-swatches") && (
        <VisualSwatchControl
          options={tweak.options ?? []}
          value={String(value)}
          onChange={onChange}
        />
      )}
      {tweak.type === "segment" && (
        <VisualSegmentedControl
          options={tweak.options ?? []}
          value={String(value)}
          onChange={onChange}
        />
      )}
      {tweak.type === "slider" && (
        <VisualSliderControl
          min={tweak.min ?? 0}
          max={tweak.max ?? 100}
          step={tweak.step ?? 1}
          unit={
            tweak.unit ??
            (tweak.cssVar?.toLowerCase().includes("radius") ? "px" : undefined)
          }
          value={Number.isFinite(numericValue) ? numericValue : 0}
          onChange={onChange}
        />
      )}
    </VisualControlRow>
  );
}
