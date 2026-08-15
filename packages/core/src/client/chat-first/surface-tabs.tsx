import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconFiles,
  IconGitCompare,
  IconMessageCircle,
  IconPlus,
  IconTerminal2,
  IconUsersGroup,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";

import {
  CHAT_FIRST_SURFACE_CATALOG,
  type ChatFirstSurfaceKind,
  type ChatFirstSurfaceTab,
} from "../chat-first.js";
import { cn } from "../utils.js";
import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstSurfaceTabsProps } from "./types.js";

const ICONS: Record<
  ChatFirstSurfaceKind,
  ComponentType<{ size?: number; className?: string }>
> = {
  app: IconFiles,
  browser: IconWorld,
  terminal: IconTerminal2,
  diff: IconGitCompare,
  files: IconFiles,
  "side-chat": IconMessageCircle,
  agents: IconUsersGroup,
};

function SurfaceIcon({ kind }: { kind: ChatFirstSurfaceKind }) {
  const Icon = ICONS[kind];
  return <Icon size={14} aria-hidden="true" />;
}

export function ChatFirstSurfaceTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onOpenSurface,
  apps = [],
  onOpenApp,
  renderAppIcon,
  onAddTab,
  addTabLabel = "New tab",
  copy = defaultChatFirstCopy,
}: ChatFirstSurfaceTabsProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-chat-first-surface-tabs
        className={cn(
          "min-w-0 border-b border-border bg-card",
          tabs.length > 0
            ? "shrink-0"
            : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        )}
      >
        {tabs.length > 0 ? (
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto px-2 py-1.5"
            role="tablist"
            aria-label={copy("openSideSurfaces")}
          >
            {tabs.map((tab, index) => (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    data-surface-tab-id={tab.id}
                    data-active={activeTabId === tab.id ? "true" : "false"}
                    className={cn(
                      "group flex h-8 min-w-0 max-w-48 shrink-0 items-center rounded-md text-xs transition-colors",
                      activeTabId === tab.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onMouseDown={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        onClose(tab);
                      }
                    }}
                    title={tab.title}
                  >
                    <button
                      type="button"
                      role="tab"
                      tabIndex={activeTabId === tab.id ? 0 : -1}
                      aria-selected={activeTabId === tab.id}
                      data-chat-first-surface-tab-id={tab.id}
                      className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onActivate(tab);
                          return;
                        }
                        const nextIndex =
                          event.key === "ArrowRight"
                            ? (index + 1) % tabs.length
                            : event.key === "ArrowLeft"
                              ? (index - 1 + tabs.length) % tabs.length
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? tabs.length - 1
                                  : -1;
                        if (nextIndex < 0) return;
                        event.preventDefault();
                        onActivate(tabs[nextIndex]);
                        requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLElement>(
                              `[data-chat-first-surface-tab-id="${CSS.escape(tabs[nextIndex].id)}"]`,
                            )
                            ?.focus();
                        });
                      }}
                      onClick={() => onActivate(tab)}
                    >
                      <SurfaceIcon kind={tab.kind} />
                      <span className="truncate">{tab.title}</span>
                    </button>
                    <button
                      type="button"
                      className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/65 opacity-0 transition-opacity hover:bg-background/70 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={copy("closeTab", { name: tab.title })}
                      title={copy("closeTab", { name: tab.title })}
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(tab);
                      }}
                    >
                      <IconX size={12} aria-hidden="true" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onClose(tab)}>
                    {copy("close")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length < 2}
                    onSelect={() => onCloseOthers(tab)}
                  >
                    {copy("closeOthers")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs[tabs.length - 1]?.id === tab.id}
                    onSelect={() => onCloseToRight(tab)}
                  >
                    {copy("closeToRight")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={onCloseAll}>
                    {copy("closeAll")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {onAddTab ? (
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/65 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={addTabLabel}
                title={addTabLabel}
                onClick={onAddTab}
              >
                <IconPlus size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-2 py-1"
            data-surface-empty-state
            aria-label={copy("openSideSurfaces")}
          >
            {CHAT_FIRST_SURFACE_CATALOG.map((surface) => {
              const label = copy(`surface.${surface.kind}.label`);
              const reason =
                surface.availability === "deferred"
                  ? copy(`surface.${surface.kind}.reason`)
                  : copy(`surface.${surface.kind}.reason`);
              const isDeferred = surface.availability === "deferred";
              const canOpenSurface =
                onOpenSurface &&
                (surface.kind === "browser" ||
                  (surface.kind === "terminal" &&
                    surface.availability === "desktop") ||
                  surface.kind === "side-chat" ||
                  surface.kind === "agents");
              const row = (
                <div
                  className={cn(
                    "flex h-7 min-w-0 items-center gap-2 rounded px-2 text-xs transition-colors",
                    canOpenSurface
                      ? "text-foreground hover:bg-accent"
                      : isDeferred
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title={!isDeferred ? reason : undefined}
                  aria-label={`${label}: ${reason}`}
                >
                  <SurfaceIcon kind={surface.kind} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {isDeferred ? (
                    <span
                      data-surface-availability="deferred"
                      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/45"
                      aria-label={copy("deferred")}
                    />
                  ) : null}
                </div>
              );
              if (canOpenSurface) {
                return (
                  <button
                    key={surface.kind}
                    type="button"
                    className="block w-full text-start"
                    title={
                      surface.kind === "browser" ? reason : copy("openActivity")
                    }
                    aria-label={
                      surface.kind === "browser" ? label : copy("openActivity")
                    }
                    onClick={() =>
                      onOpenSurface(
                        surface.kind === "side-chat" ? "agents" : surface.kind,
                      )
                    }
                  >
                    {row}
                  </button>
                );
              }
              if (!isDeferred) return <div key={surface.kind}>{row}</div>;
              return (
                <Tooltip key={surface.kind}>
                  <TooltipTrigger asChild>
                    <div className="text-start">{row}</div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-72">
                    {reason}
                  </TooltipContent>
                </Tooltip>
              );
            })}
            {apps.length > 0 && onOpenApp ? (
              <div className="mt-1 border-t border-border pt-1">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {copy("workspaceApps")}
                </p>
                <div className="space-y-0.5">
                  {apps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      data-chat-first-surface-app={app.id}
                      className="flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-start text-xs text-foreground transition-colors hover:bg-accent"
                      title={copy("openApp", { name: app.name })}
                      aria-label={copy("openApp", { name: app.name })}
                      onClick={() => onOpenApp(app)}
                    >
                      {renderAppIcon?.(app) ?? <SurfaceIcon kind="app" />}
                      <span className="min-w-0 flex-1 truncate">
                        {app.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function ChatFirstSurfaceContent({
  tabs,
  activeTabId,
  renderTab,
}: {
  tabs: readonly ChatFirstSurfaceTab[];
  activeTabId: string | null;
  renderTab: (tab: ChatFirstSurfaceTab) => ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-chat-first-surface-content={tab.id}
            aria-hidden={!active}
            className={cn("h-full min-h-0", !active && "hidden")}
          >
            {renderTab(tab)}
          </div>
        );
      })}
    </div>
  );
}
