import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const MENU_CONTENT_CLASS =
  "w-52 min-w-[200px] data-[state=open]:!animate-none data-[state=closed]:!animate-none";

export function CanvasMenuItem({
  hidden,
  disabled,
  destructive,
  label,
  description,
  disabledReason,
  shortcut,
  onSelect,
}: {
  hidden?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  label: string;
  description?: string;
  disabledReason?: string;
  shortcut?: string;
  onSelect: (event: Event) => void;
}) {
  if (hidden) return null;

  const item = (
    <ContextMenuItem
      disabled={disabled}
      onSelect={onSelect}
      variant={destructive ? "destructive" : "default"}
    >
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{label}</span>
          <span className="truncate text-muted-foreground">{description}</span>
        </span>
      ) : (
        <span className="flex-1 truncate">{label}</span>
      )}
      {shortcut ? <ContextMenuShortcut>{shortcut}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  );

  if (!disabled || !disabledReason) return item;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{item}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
