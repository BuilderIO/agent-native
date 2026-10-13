import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { MENU_ITEM_CLASS, MENU_SHORTCUT_CLASS } from "./context-menu-styles";

export function CanvasMenuItem({
  hidden,
  disabled,
  destructive,
  label,
  description,
  shortcut,
  onSelect,
}: {
  hidden?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  label: string;
  description?: string;
  shortcut?: string;
  onSelect: (event: Event) => void;
}) {
  if (hidden) return null;

  return (
    <ContextMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        MENU_ITEM_CLASS,
        description && "h-auto py-1",
        destructive &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive",
      )}
    >
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{label}</span>
          <span className="truncate text-muted-foreground">{description}</span>
        </span>
      ) : (
        <span className="flex-1 truncate">{label}</span>
      )}
      {shortcut ? (
        <ContextMenuShortcut className={MENU_SHORTCUT_CLASS}>
          {shortcut}
        </ContextMenuShortcut>
      ) : null}
    </ContextMenuItem>
  );
}
