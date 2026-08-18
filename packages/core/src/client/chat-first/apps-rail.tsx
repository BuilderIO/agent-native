import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconApps,
  IconChevronDown,
  IconChevronUp,
  IconPin,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import {
  CHAT_FIRST_DEFAULT_APP_IDS,
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  type ChatFirstAppLayoutPreference,
} from "../chat-first.js";
import { cn } from "../utils.js";
import { defaultChatFirstCopy } from "./copy.js";
import type {
  ChatFirstAppItem,
  ChatFirstAppIconRenderOptions,
  ChatFirstAppRailProps,
  ChatFirstCopy,
} from "./types.js";

function ChatFirstRailAppIcon({
  app,
  activeAppId,
  renderIcon,
}: {
  app: ChatFirstAppItem;
  activeAppId?: string;
  renderIcon: (
    app: ChatFirstAppItem,
    options?: ChatFirstAppIconRenderOptions,
  ) => ReactNode;
}) {
  const isActive = activeAppId !== undefined && activeAppId === app.id;
  const isInactive = activeAppId !== undefined && !isActive;

  return (
    <span
      data-chat-first-app-icon
      className={cn("transition-[filter]", isInactive && "grayscale")}
    >
      {renderIcon(app, { isActive, isInactive })}
    </span>
  );
}

function AppRows({
  apps,
  defaultAppIds,
  activeAppId,
  layout,
  onDragStart,
  onDrop,
  onDragEnd,
  onOpenApp,
  onRemoveApp,
  onTogglePinned,
  onMove,
  renderIcon,
  copy,
}: {
  apps: ChatFirstAppItem[];
  defaultAppIds?: readonly string[];
  activeAppId?: string;
  layout: ChatFirstAppLayoutPreference;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
  onOpenApp: (app: ChatFirstAppItem) => void;
  onRemoveApp?: (app: ChatFirstAppItem) => void;
  onTogglePinned: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  renderIcon: (
    app: ChatFirstAppItem,
    options?: ChatFirstAppIconRenderOptions,
  ) => ReactNode;
  copy: ChatFirstCopy;
}) {
  const orderedIds = orderChatFirstAppIds(
    apps.map((app) => app.id),
    layout,
    defaultAppIds,
  );
  const appsById = new Map(apps.map((app) => [app.id, app]));
  const orderedApps = orderedIds
    .map((id) => appsById.get(id))
    .filter((app): app is ChatFirstAppItem => Boolean(app));

  return (
    <ul className="space-y-1">
      {orderedApps.map((app) => {
        const active = activeAppId === app.id;
        const pinned = layout.pinnedIds.includes(app.id);
        const index = orderedApps.indexOf(app);
        return (
          <ContextMenu key={app.id}>
            <ContextMenuTrigger asChild>
              <li
                draggable
                data-chat-first-app
                data-app-id={app.id}
                className={cn(
                  "group flex h-8 w-full min-w-0 items-center gap-1 rounded-md px-0 text-sm",
                  active
                    ? "font-medium text-sidebar-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  onDragStart(app.id);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDrop(app.id)}
                onDragEnd={onDragEnd}
              >
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-start"
                  onClick={() => onOpenApp(app)}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      onMove(app.id, -1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      onMove(app.id, 1);
                    }
                  }}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  aria-label={copy("openApp", { name: app.name })}
                >
                  <ChatFirstRailAppIcon
                    app={app}
                    activeAppId={activeAppId}
                    renderIcon={renderIcon}
                  />
                  <span className="truncate">{app.name}</span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded text-sidebar-foreground/45 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100 focus-visible:opacity-100",
                    pinned && "text-sidebar-foreground/70 opacity-100",
                  )}
                  aria-label={copy(pinned ? "unpinApp" : "pinApp", {
                    name: app.name,
                  })}
                  aria-pressed={pinned}
                  onClick={() => onTogglePinned(app.id)}
                >
                  <IconPin
                    size={13}
                    strokeWidth={pinned ? 2.2 : 1.6}
                    aria-hidden="true"
                  />
                </button>
                <span className="sr-only">
                  {`${index + 1} of ${orderedApps.length}`}
                </span>
              </li>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onTogglePinned(app.id)}>
                <IconPin size={14} aria-hidden="true" />
                {pinned ? copy("removePinned") : copy("pinTop")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={index === 0}
                onSelect={() => onMove(app.id, -1)}
              >
                <IconChevronUp size={14} aria-hidden="true" />
                {copy("moveUp")}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={index === orderedApps.length - 1}
                onSelect={() => onMove(app.id, 1)}
              >
                <IconChevronDown size={14} aria-hidden="true" />
                {copy("moveDown")}
              </ContextMenuItem>
              {onRemoveApp ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => onRemoveApp(app)}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash size={14} aria-hidden="true" />
                    {copy("removeApp")}
                  </ContextMenuItem>
                </>
              ) : null}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </ul>
  );
}

export const ChatFirstAppsRail = memo(function ChatFirstAppsRail({
  apps,
  defaultAppIds,
  activeAppId,
  loading = false,
  error,
  collapsed = false,
  layout: controlledLayout,
  onLayoutChange,
  onLayoutError,
  onRetry,
  onOpenApp,
  onRemoveApp,
  onOpenAllApps,
  onCreateApp,
  createAppTrigger,
  renderIcon,
  copy = defaultChatFirstCopy,
}: ChatFirstAppRailProps) {
  const [localLayout, setLocalLayout] = useState<ChatFirstAppLayoutPreference>(
    () => readChatFirstAppLayout(),
  );
  const layout = controlledLayout ?? localLayout;
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [showAllApps, setShowAllApps] = useState(false);
  const orderedApps = useMemo(() => {
    const orderedIds = orderChatFirstAppIds(
      apps.map((app) => app.id),
      layout,
      defaultAppIds,
    );
    const appsById = new Map(apps.map((app) => [app.id, app]));
    return orderedIds
      .map((id) => appsById.get(id))
      .filter((app): app is ChatFirstAppItem => Boolean(app));
  }, [apps, defaultAppIds, layout]);
  const visibleApps = useMemo(() => {
    if (showAllApps) return orderedApps;

    const defaultApps = orderedApps.slice(
      0,
      defaultAppIds?.length ?? CHAT_FIRST_DEFAULT_APP_IDS.length,
    );
    if (!activeAppId || defaultApps.some((app) => app.id === activeAppId)) {
      return defaultApps;
    }

    const activeApp = orderedApps.find((app) => app.id === activeAppId);
    return activeApp ? [...defaultApps, activeApp] : defaultApps;
  }, [activeAppId, defaultAppIds, orderedApps, showAllApps]);
  const hasMoreApps = orderedApps.length > visibleApps.length;
  const createTrigger =
    createAppTrigger ??
    (onCreateApp ? (
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        onClick={onCreateApp}
        aria-label={copy("createWorkspaceApp")}
        title={copy("createWorkspaceApp")}
      >
        <IconPlus size={14} aria-hidden="true" />
      </button>
    ) : null);

  function persistLayout(next: ChatFirstAppLayoutPreference) {
    setLocalLayout(next);
    onLayoutChange?.(next);
    const result = writeChatFirstAppLayout(next);
    if (!result.ok) onLayoutError?.(result.reason);
  }

  function togglePinned(appId: string) {
    const pinnedIds = layout.pinnedIds.includes(appId)
      ? layout.pinnedIds.filter((id) => id !== appId)
      : [appId, ...layout.pinnedIds];
    persistLayout({ ...layout, pinnedIds });
  }

  function reorderApps(targetId: string) {
    if (!draggedAppId || draggedAppId === targetId) return;
    const currentOrder = orderChatFirstAppIds(
      apps.map((app) => app.id),
      layout,
      defaultAppIds,
    );
    const fromIndex = currentOrder.indexOf(draggedAppId);
    const toIndex = currentOrder.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, draggedAppId);
    persistLayout({ ...layout, orderedIds: nextOrder });
    setDraggedAppId(null);
  }

  function moveApp(appId: string, direction: -1 | 1) {
    const currentOrder = orderChatFirstAppIds(
      apps.map((app) => app.id),
      layout,
      defaultAppIds,
    );
    const index = currentOrder.indexOf(appId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [
      nextOrder[nextIndex],
      nextOrder[index],
    ];
    persistLayout({ ...layout, orderedIds: nextOrder });
  }

  if (collapsed) {
    return (
      <section
        data-chat-first-apps-rail
        className="flex flex-col items-center gap-1 px-1.5 pt-2"
        aria-label={copy("workspaceApps")}
      >
        {loading && apps.length === 0
          ? [0, 1, 2].map((index) => (
              <Skeleton key={index} className="size-9 rounded-md" />
            ))
          : visibleApps.map((app) => (
              <button
                key={app.id}
                type="button"
                data-chat-first-app
                data-app-id={app.id}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md",
                  activeAppId === app.id
                    ? "text-sidebar-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
                onClick={() => onOpenApp(app)}
                aria-label={copy("openApp", { name: app.name })}
                title={app.name}
              >
                <ChatFirstRailAppIcon
                  app={app}
                  activeAppId={activeAppId}
                  renderIcon={renderIcon}
                />
              </button>
            ))}
        {onOpenAllApps ? (
          <button
            type="button"
            data-chat-first-all-apps
            className="flex size-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={onOpenAllApps}
            aria-label={copy("allApps")}
            title={copy("allApps")}
          >
            <IconApps size={16} aria-hidden="true" />
          </button>
        ) : null}
        {error ? (
          <span
            className="size-1.5 rounded-full bg-destructive"
            title={error}
            aria-label={error}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section
      data-chat-first-apps-rail
      className="mt-3 px-2 pb-2 pt-2"
      aria-label={copy("workspaceApps")}
    >
      <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium text-sidebar-foreground/50">
        <span>{copy("workspaceApps")}</span>
        <span className="ml-auto">{createTrigger}</span>
      </div>
      {loading && apps.length === 0 ? (
        <div className="space-y-0.5 px-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-8 w-full rounded-md" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <div className="px-2">
          <p className="text-xs text-sidebar-foreground/55">
            {copy("noWorkspaceApps")}
          </p>
          {createAppTrigger ? (
            createTrigger
          ) : onCreateApp ? (
            <button
              type="button"
              className="mt-1 inline-flex h-6 items-center gap-1.5 rounded-md border border-sidebar-border px-2 text-xs text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={onCreateApp}
            >
              <IconPlus size={13} aria-hidden="true" />
              {copy("createApp")}
            </button>
          ) : (
            createTrigger
          )}
        </div>
      ) : (
        <AppRows
          apps={visibleApps}
          defaultAppIds={defaultAppIds}
          activeAppId={activeAppId}
          layout={layout}
          onDragStart={setDraggedAppId}
          onDrop={reorderApps}
          onDragEnd={() => setDraggedAppId(null)}
          onOpenApp={onOpenApp}
          onRemoveApp={onRemoveApp}
          onTogglePinned={togglePinned}
          onMove={moveApp}
          renderIcon={renderIcon}
          copy={copy}
        />
      )}
      {hasMoreApps || showAllApps ? (
        <button
          type="button"
          className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => setShowAllApps((value) => !value)}
        >
          {showAllApps ? (
            <IconChevronUp size={14} aria-hidden="true" />
          ) : (
            <IconChevronDown size={14} aria-hidden="true" />
          )}
          {showAllApps ? copy("showLess") : copy("showMore")}
        </button>
      ) : null}
      {onOpenAllApps ? (
        <div className="mt-1 border-t border-sidebar-border/60 pt-1">
          <button
            type="button"
            data-chat-first-all-apps
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={onOpenAllApps}
          >
            <IconApps size={14} aria-hidden="true" />
            <span>{copy("allApps")}</span>
          </button>
        </div>
      ) : null}
      {error ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="mt-1 flex items-center gap-1 px-2 text-[10px] text-destructive/80"
              onClick={onRetry}
              aria-label={error}
            >
              <span className="size-1.5 rounded-full bg-destructive" />
              {onRetry ? copy("retry") : copy("appsLoadError")}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{error}</TooltipContent>
        </Tooltip>
      ) : null}
    </section>
  );
});
