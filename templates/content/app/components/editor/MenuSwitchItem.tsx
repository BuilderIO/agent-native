import type { ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** A menu item that toggles a setting and keeps its menu open. */
export function MenuSwitchItem({
  checked,
  children,
  onToggle,
  switchTestId,
}: {
  checked: boolean;
  children: ReactNode;
  onToggle: () => void;
  switchTestId?: string;
}) {
  return (
    <DropdownMenuItem
      aria-checked={checked}
      className="gap-2"
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
      role="menuitemcheckbox"
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/25",
        )}
        data-state={checked ? "checked" : "unchecked"}
        data-testid={switchTestId}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-background shadow-sm transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </DropdownMenuItem>
  );
}
