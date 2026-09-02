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
  IconTerminal2,
} from "@tabler/icons-react";

export interface DesktopChatFirstSurfaceMenuProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNewCliTab?: () => void;
  onNewUiTab?: () => void;
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
          {onNewCliTab ? (
            <DropdownMenuItem onSelect={onNewCliTab}>
              <IconTerminal2 size={14} className="shrink-0" />
              New CLI tab
            </DropdownMenuItem>
          ) : null}
          {onNewUiTab ? (
            <DropdownMenuItem onSelect={onNewUiTab}>
              <IconMessageCircle size={14} className="shrink-0" />
              New UI tab
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export default function DesktopChatFirstSurfaceMenu({
  ...props
}: DesktopChatFirstSurfaceMenuProps) {
  return (
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
        <DesktopChatFirstSurfaceMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
