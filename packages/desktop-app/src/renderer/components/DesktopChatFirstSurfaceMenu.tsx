import type { ChatFirstAppItem } from "@agent-native/core/client/chat-first";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconApps,
  IconDotsVertical,
  IconLayoutSidebarRightCollapse,
  IconMessageCircle,
  IconTerminal2,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface DesktopChatFirstSurfaceMenuProps {
  sidebarOpen?: boolean;
  apps?: readonly ChatFirstAppItem[];
  onToggleSidebar?: () => void;
  onOpenApp?: (app: ChatFirstAppItem) => void;
  renderAppIcon?: (app: ChatFirstAppItem) => ReactNode;
  onNewCliTab?: () => void;
  onNewUiTab?: () => void;
}

export function DesktopChatFirstSurfaceMenuItems({
  sidebarOpen = false,
  apps = [],
  onToggleSidebar,
  onOpenApp,
  renderAppIcon,
  onNewCliTab,
  onNewUiTab,
}: DesktopChatFirstSurfaceMenuProps) {
  const hasAppPicker = apps.length > 0 && Boolean(onOpenApp);
  if (!onToggleSidebar && !hasAppPicker && !onNewCliTab && !onNewUiTab) {
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
      {hasAppPicker ? (
        <>
          {onToggleSidebar ? <DropdownMenuSeparator /> : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconApps size={14} className="shrink-0" />
              Open app in sidebar
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {apps.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  onSelect={() => onOpenApp?.(app)}
                >
                  {renderAppIcon?.(app) ?? (
                    <IconApps size={14} className="shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{app.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : null}
      {onNewCliTab || onNewUiTab ? (
        <>
          {(onToggleSidebar || hasAppPicker) && <DropdownMenuSeparator />}
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
