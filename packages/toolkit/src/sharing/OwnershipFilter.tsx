import { IconChevronDown } from "@tabler/icons-react";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { cn } from "../utils.js";

export const OWNERSHIP_FILTER_VALUES = ["all", "mine", "shared"] as const;

export type OwnershipFilterValue = (typeof OWNERSHIP_FILTER_VALUES)[number];

/** Translated by the app; the toolkit ships no copy for the three options. */
export type OwnershipFilterLabels = Record<OwnershipFilterValue, string>;

export interface OwnershipFilterProps {
  value: OwnershipFilterValue;
  onChange: (value: OwnershipFilterValue) => void;
  labels: OwnershipFilterLabels;
  className?: string;
}

function isOwnershipFilterValue(value: string): value is OwnershipFilterValue {
  return (OWNERSHIP_FILTER_VALUES as readonly string[]).includes(value);
}

/**
 * Pure and app-controlled: it renders the choice and reports it. Whether the
 * app narrows rows client-side or refetches with the value is the app's call.
 */
export function OwnershipFilter({
  value,
  onChange,
  labels,
  className,
}: OwnershipFilterProps) {
  const label = labels[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          className={cn("h-9 shrink-0 gap-2", className)}
        >
          {/* Every option is rendered invisibly so the trigger keeps one width. */}
          <span className="grid">
            {OWNERSHIP_FILTER_VALUES.map((option) => (
              <span
                key={option}
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
              >
                {labels[option]}
              </span>
            ))}
            <span className="col-start-1 row-start-1 whitespace-nowrap">
              {label}
            </span>
          </span>
          <IconChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isOwnershipFilterValue(next)) onChange(next);
          }}
        >
          {OWNERSHIP_FILTER_VALUES.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              indicator="check"
            >
              {labels[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Client-side narrowing for apps that already hold every row. Apps that page
 * from the server should send the filter value instead and skip this.
 */
export function filterByOwnership<T>(
  items: readonly T[],
  value: OwnershipFilterValue,
  isMine: (item: T) => boolean,
): T[] {
  if (value === "all") return [...items];
  return items.filter((item) => isMine(item) === (value === "mine"));
}
