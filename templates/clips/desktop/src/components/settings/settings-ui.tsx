/**
 * Presentation for the tray Settings surface, built on Tailwind + the shadcn
 * primitives in `@/components/ui`. Everything here is layout and typography —
 * no Tauri calls, no feature state — so a row's behavior stays in app.tsx and
 * its shape stays here.
 */
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
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

/**
 * The single shape every control in a settings row wears: same height, same
 * radius, same fill, same type size, same hover. Dropdowns, keycaps, value
 * triggers, and action buttons are interchangeable in a row, so a control that
 * invents its own size is the thing that reads as sloppy.
 *
 * At rest it is the page's own background inside a hairline the same weight as
 * the card's — `border-border`, not the heavier `border-input`. The grey fill is
 * the hover state and nothing else, so a row of controls reads as quiet until
 * the pointer is actually over one.
 */
const ROW_CONTROL =
  "h-8 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/** A card of rows. `label` is the small uppercase divider; omit it when the
 *  tab is a single card and its heading already names the group. */
export function SettingsGroup({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      {label ? (
        <div className="px-0.5 pb-1.5 text-2xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting per row: label and a grounding line on the left, its current
 * state on the right.
 *
 * Every row carries a `description` by product decision — a desktop setting
 * that silently changes OS-level behavior needs grounding the label alone
 * cannot give. It must say something the label does not: where the setting
 * applies, what the user will see, what it costs. Restating the label ("Keep
 * dictation visible — keeps dictation visible") is the failure mode, and the
 * reason to delete a line rather than pad it.
 */
export function SettingsRow({
  label,
  description,
  control,
  children,
  stacked = false,
}: {
  label: string;
  description?: string;
  control?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        // The divider is a pseudo-element inset to the row's own padding, not a
        // `border-b`. An edge-to-edge rule cuts the card into stacked boxes;
        // stopping it short of the corners keeps one card with rows inside it.
        // Dimmer than the card's own outline too — it separates siblings rather
        // than bounding the card, so it should not compete with the edge.
        "relative grid min-h-[46px] min-w-0 items-center gap-4 px-3.5 py-2.5",
        "after:absolute after:inset-x-3.5 after:bottom-0 after:h-px after:bg-border/50 after:content-[''] last:after:hidden",
        stacked
          ? "grid-cols-[minmax(0,1fr)] items-start gap-2"
          : "grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-base font-medium text-foreground">
          {label}
        </span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {control ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            stacked ? "w-full justify-start" : "justify-end",
          )}
        >
          {control}
        </div>
      ) : null}
      {children ? (
        <div className="col-span-full grid min-w-0 gap-2 text-xs text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A dropdown wearing the shared row-control shape. */
export function SettingsSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  /** Shown when `value` matches no option — a catalog still loading, or empty.
   *  Without it the trigger renders as a bare chevron. */
  placeholder,
  disabled = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  // Radix renders the placeholder only for an empty value, so a stored value
  // that matches no option (a catalog still loading) would otherwise leave the
  // trigger showing nothing but its chevron.
  const selected = options.some((option) => option.value === value);

  return (
    <Select
      value={selected ? value : ""}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(ROW_CONTROL, "w-auto gap-1.5 shadow-none focus:ring-0")}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="text-sm"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shows the current value and opens its detail — a dropdown in every respect
 *  a user can see, so it wears the same shape. */
export function SettingsValueTrigger({
  value,
  mono = false,
  className,
  ...props
}: {
  value: string;
  mono?: boolean;
} & React.ComponentPropsWithRef<"button">) {
  return (
    <button
      type="button"
      className={cn(
        ROW_CONTROL,
        "inline-flex max-w-60 items-center gap-1.5",
        className,
      )}
      {...props}
    >
      <span className={cn("truncate", mono && "font-mono text-xs")}>
        {value}
      </span>
      <IconChevronDown
        className="size-3.5 shrink-0 opacity-50"
        stroke={1.9}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * An action in a settings row: a real button, never a bare text link, and by
 * default the same soft filled shape as the dropdowns it sits beside.
 * `primary` is for the single action a row wants you to take; `quiet` is for a
 * secondary one that should not compete with the control next to it.
 */
export function SettingsActionButton({
  className,
  emphasis = "soft",
  ...props
}: { emphasis?: "soft" | "primary" | "quiet" } & Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size"
>) {
  return (
    <Button
      variant={emphasis === "primary" ? "default" : "ghost"}
      className={cn(
        "gap-1.5",
        emphasis === "soft" && ROW_CONTROL,
        emphasis === "primary" && "h-8 rounded-lg px-3 text-sm font-medium",
        emphasis === "quiet" &&
          "h-8 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A titled popover for a setting's detail. The tray window is small and
 * chromeless, so the title and close button orient the user inside a layer
 * that has no window frame of its own.
 */
export function SettingsPopover({
  title,
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  className,
}: {
  title: string;
  trigger: ReactElement;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "bottom" | "left" | "right" | "top";
  className?: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={8}
        collisionPadding={12}
        data-popover-overlay="true"
        className={cn("w-80 p-3", className)}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold" role="heading" aria-level={2}>
            {title}
          </div>
          <PopoverClose
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Close ${title}`}
          >
            <IconX className="size-3.5" stroke={1.9} />
          </PopoverClose>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A one-of-many setting whose choices need more room than a select — because
 * picking one reveals a follow-up control. `keepOpenValues` names those, so the
 * popover does not close before the user can finish.
 */
export function SettingsChoicePopover({
  title,
  value,
  options,
  onChange,
  trigger,
  keepOpenValues,
  children,
}: {
  title: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  trigger: ReactElement;
  keepOpenValues?: string[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <SettingsPopover
      title={title}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
    >
      <div className="grid gap-2">
        {/* Plain toggle buttons, not role="listbox"/"option": those roles
            promise arrow-key navigation and typeahead this popover does not
            implement, so a screen reader would announce a contract the
            keyboard cannot honor. Tab-per-button with aria-pressed matches
            how it actually behaves. */}
        <div className="grid gap-0.5" role="group" aria-label={title}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors",
                  selected
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => {
                  onChange(option.value);
                  if (!keepOpenValues?.includes(option.value)) setOpen(false);
                }}
              >
                <span className="truncate">{option.label}</span>
                {selected ? (
                  <IconCheck className="size-3.5 shrink-0" stroke={2.1} />
                ) : null}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </SettingsPopover>
  );
}

/** The keycap rendering of a shortcut, e.g. `⌘⇧Space`. */
export function SettingsKeycap({
  children,
  active = false,
  className,
  ...props
}: {
  active?: boolean;
} & React.ComponentPropsWithRef<"button">) {
  return (
    <button
      type="button"
      className={cn(
        ROW_CONTROL,
        "inline-flex items-center whitespace-nowrap",
        active && "border-ring bg-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
