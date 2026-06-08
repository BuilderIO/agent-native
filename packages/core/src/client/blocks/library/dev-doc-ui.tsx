import { forwardRef } from "react";
import type {
  ComponentProps,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "../../utils.js";

/**
 * Minimal, app-agnostic form primitives for the core "dev-doc" block library
 * (mermaid / api-endpoint / data-model / diff / file-tree / json-explorer /
 * annotated-code).
 * These blocks previously imported the plan app's shadcn/ui
 * components (`@/components/ui/*`); core blocks must stay portable, so these are
 * plain styled elements that reproduce the SAME shadcn Tailwind classes byte-for
 * -byte. They resolve against whatever shadcn token theme (`border-input`,
 * `bg-background`, `ring-ring`, …) the host app ships, so the rendered look is
 * unchanged across apps.
 *
 * The Select is intentionally a NATIVE `<select>` styled to match the shadcn
 * trigger rather than a Radix popover: it keeps core dependency-free and behaves
 * identically for the simple enum pickers these editors use (method, change,
 * param location, diff mode).
 */

/* ── Input ─────────────────────────────────────────────────────────────────── */

export const DevInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    )}
    {...props}
  />
));
DevInput.displayName = "DevInput";

/* ── Label ─────────────────────────────────────────────────────────────────── */

export const DevLabel = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
DevLabel.displayName = "DevLabel";

/* ── Textarea ──────────────────────────────────────────────────────────────── */

export const DevTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
DevTextarea.displayName = "DevTextarea";

/* ── Badge ─────────────────────────────────────────────────────────────────── */

/** Only the `outline` badge variant is used by these blocks. */
export function DevBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ── Switch ────────────────────────────────────────────────────────────────── */

/**
 * A native-checkbox toggle styled to read like the shadcn Switch. `onCheckedChange`
 * mirrors the shadcn/Radix API so call sites stay identical.
 */
export function DevSwitch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
} & Omit<
  InputHTMLAttributes<HTMLButtonElement>,
  "onChange" | "checked" | "type"
>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-plan-interactive
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
      {...(props as Record<string, unknown>)}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

/* ── Select (native, shadcn-trigger styled) ────────────────────────────────── */

export interface DevSelectOption {
  value: string;
  label: ReactNode;
}

/**
 * A native `<select>` styled to match the shadcn SelectTrigger. Drop-in for the
 * simple enum pickers the dev-doc editors use. `onValueChange` mirrors the shadcn
 * API. The chevron is positioned over the native control.
 */
export function DevSelect({
  value,
  onValueChange,
  options,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: DevSelectOption[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        data-plan-interactive
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          "flex h-10 w-full appearance-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {typeof option.label === "string" ? option.label : option.value}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 opacity-50" />
    </div>
  );
}
