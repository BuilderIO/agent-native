import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

export const MENU_CONTENT_CLASS =
  "w-52 min-w-[200px] data-[state=open]:!animate-none data-[state=closed]:!animate-none";

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
}
