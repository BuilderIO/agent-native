import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";

export interface ComposerModeOption {
  /** Stable host-defined mode identifier. */
  value: string;
  /** Localized visible label supplied by the host. */
  label: string;
  /** Optional localized explanation, shown as the option's tooltip. */
  description?: string;
  /** Optional host-provided icon. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ComposerModePickerProps {
  /** Localized accessible name for this choice, such as "Ask mode". */
  ariaLabel: string;
  value: string;
  options: readonly ComposerModeOption[];
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * A shared, host-configurable mode picker for composer modes that are not part
 * of the framework's built-in Act/Plan execution setting.
 */
export function ComposerModePicker({
  ariaLabel,
  value,
  options,
  onValueChange,
  className,
}: ComposerModePickerProps) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel}: ${selectedLabel}`}
          data-agent-composer-slot="mode-picker"
          className={cn(
            "agent-composer-mode-picker inline-flex h-6 max-w-48 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {selectedOption?.icon}
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <IconChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 opacity-60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        collisionPadding={8}
        className="agent-composer-mode-picker-menu min-w-48"
      >
        {/* Hosts may render this picker outside a TooltipProvider. */}
        <TooltipProvider>
          <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => {
              const item = (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  indicator="check"
                  {...(option.disabled === undefined
                    ? {}
                    : { disabled: option.disabled })}
                  className="agent-composer-mode-picker-option pe-3"
                >
                  {option.icon}
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </DropdownMenuRadioItem>
              );
              return option.description ? (
                <Tooltip key={option.value}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    {option.description}
                  </TooltipContent>
                </Tooltip>
              ) : (
                item
              );
            })}
          </DropdownMenuRadioGroup>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
