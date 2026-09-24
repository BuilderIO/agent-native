import { IconDots } from "@tabler/icons-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RowActionsMenuProps {
  ariaLabel: string;
  disabled?: boolean;
  children: ReactNode;
}

export function RowActionsMenu({
  ariaLabel,
  disabled = false,
  children,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={ariaLabel}
          onClick={(event) => event.stopPropagation()}
          className="relative z-10 size-8 text-muted-foreground opacity-70 hover:text-foreground"
        >
          <IconDots />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
