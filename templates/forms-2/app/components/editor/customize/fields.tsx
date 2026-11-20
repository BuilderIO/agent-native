import { normalizeHex } from "@shared/theme/form-theme";
import { useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const controlClass =
  "h-[29px] rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 aria-[invalid=true]:border-destructive";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: (id: string) => ReactNode;
  className?: string | undefined;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] leading-[14px] text-muted-foreground"
      >
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="mb-6">
      <h4 id={id} className="mb-3 text-[13px] font-semibold">
        {title}
      </h4>
      <div className="flex flex-col gap-[9px]">{children}</div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = normalizeHex(text) !== null;
  return (
    <Field label={label}>
      {(id) => (
        <div className="relative">
          <label className="absolute top-1/2 left-2 size-4 -translate-y-1/2 cursor-pointer overflow-hidden rounded-full border border-input">
            <span
              className="block size-full"
              style={{ backgroundColor: value }}
            />
            <input
              type="color"
              aria-hidden
              tabIndex={-1}
              value={value.slice(0, 7)}
              onChange={(event) => onChange(event.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
          <input
            id={id}
            value={text}
            aria-invalid={!valid}
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              const hex = normalizeHex(event.target.value);
              if (hex && hex.length !== 4) onChange(hex);
            }}
            onBlur={() => setText(value)}
            className={cn(controlClass, "w-full pl-8")}
          />
        </div>
      )}
    </Field>
  );
}

/** A text box showing `24px` or `25%`; typing the bare number or the unit both work. */
export function UnitInput({
  id,
  value,
  min,
  max,
  unit = "px",
  shown,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  unit?: "px" | "%";
  /** Replaces the number while the control is not editable, such as `auto`. */
  shown?: string | undefined;
  onChange: (value: number) => void;
}) {
  const display = shown ?? `${value}${unit}`;
  const [text, setText] = useState(display);
  useEffect(() => setText(display), [display]);
  const parse = (raw: string) => {
    const match = /^\s*(\d+)\s*(px|%)?\s*$/i.exec(raw);
    const next = match ? Number(match[1]) : NaN;
    return next >= min && next <= max ? next : null;
  };
  return (
    <input
      id={id}
      value={text}
      disabled={shown !== undefined}
      aria-invalid={shown === undefined && parse(text) === null}
      spellCheck={false}
      onChange={(event) => {
        setText(event.target.value);
        const next = parse(event.target.value);
        if (next !== null) onChange(next);
      }}
      onBlur={() => setText(display)}
      className={cn(controlClass, "w-full")}
    />
  );
}

export function UnitField({
  label,
  className,
  ...input
}: { label: string; className?: string } & Omit<
  Parameters<typeof UnitInput>[0],
  "id"
>) {
  return (
    <Field label={label} className={className}>
      {(id) => <UnitInput id={id} {...input} />}
    </Field>
  );
}

export function SegmentedRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex h-[29px] shrink-0 gap-px rounded-md bg-muted p-px"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex w-8 items-center justify-center rounded-[5px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
              checked &&
                "border border-input bg-background text-foreground shadow-sm",
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
