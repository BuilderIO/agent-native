import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconDotsVertical,
  IconLayoutSidebarRightCollapse,
  IconMessageCircle,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";

export interface DesktopChatFirstSurfaceMenuProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNewCliTab?: () => void;
  onNewUiTab?: () => void;
  onClose?: () => void;
}

export function DesktopChatFirstSurfaceMenuItems({
  sidebarOpen = false,
  onToggleSidebar,
  onNewCliTab,
  onNewUiTab,
}: DesktopChatFirstSurfaceMenuProps) {
  if (!onToggleSidebar && !onNewCliTab && !onNewUiTab) {
    return null;
  }

  return (
    <>
      {onToggleSidebar ? (
        <DropdownMenuItem onSelect={onToggleSidebar}>
          <IconLayoutSidebarRightCollapse size={14} className="shrink-0" />
          {sidebarOpen ? "Hide sidebar" : "Open sidebar"}
        </DropdownMenuItem>
      ) : null}
      {onNewCliTab || onNewUiTab ? (
        <>
          {onToggleSidebar && <DropdownMenuSeparator />}
          {onNewUiTab ? (
            <DropdownMenuItem onSelect={onNewUiTab}>
              <IconMessageCircle size={14} className="shrink-0" />
              New UI tab
            </DropdownMenuItem>
          ) : null}
          {onNewCliTab ? (
            <DropdownMenuItem onSelect={onNewCliTab}>
              <IconTerminal2 size={14} className="shrink-0" />
              New CLI tab
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export default function DesktopChatFirstSurfaceMenu({
  onNewUiTab,
  onClose,
  ...props
}: DesktopChatFirstSurfaceMenuProps) {
  return (
    <div className="flex items-center gap-0.5">
      {onNewUiTab ? (
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="New UI tab"
          title="New UI tab"
          onClick={onNewUiTab}
        >
          <IconPlus size={15} aria-hidden="true" />
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Surface options"
            title="Surface options"
          >
            <IconDotsVertical size={15} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-56">
          <DesktopChatFirstSurfaceMenuItems
            {...props}
            onNewUiTab={onNewUiTab}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {onClose ? (
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close chat"
          title="Close chat"
          onClick={onClose}
        >
          <IconX size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
