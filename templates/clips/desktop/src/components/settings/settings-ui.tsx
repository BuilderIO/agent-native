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

const ROW_CONTROL =
  "h-8 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

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

export function SettingsSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
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
  const selected = options.some((option) => option.value === value);

  return (
    <Select
      value={selected ? value : ""}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          ROW_CONTROL,
          "w-auto gap-1.5 shadow-none focus:ring-0 focus:ring-offset-0",
        )}
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

export function SettingsActionButton({
  className,
  emphasis = "soft",
  ...props
}: { emphasis?: "soft" | "primary" | "quiet" | "destructive" } & Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size"
>) {
  return (
    <Button
      variant={emphasis === "primary" ? "default" : "ghost"}
      className={cn(
        "gap-1.5",
        emphasis === "soft" && ROW_CONTROL,
        emphasis === "primary" && "h-8 rounded-md px-3 text-sm font-medium",
        emphasis === "quiet" &&
          "h-8 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent",
        emphasis === "destructive" &&
          "h-8 rounded-md px-2 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

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
                  "flex w-full items-center justify-between gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm font-medium transition-colors",
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
