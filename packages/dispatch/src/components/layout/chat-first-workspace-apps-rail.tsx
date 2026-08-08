import {
  CHAT_FIRST_OPEN_APP_EVENT,
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  type ChatFirstAppLayoutPreference,
} from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconApps,
  IconGripVertical,
  IconPin,
  IconPlus,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";
import { AppIcon } from "../app-icon";
import { CreateAppPopover } from "../create-app-popover";
import { Skeleton } from "../ui/skeleton";
import { useDispatchChatFirstPane } from "./chat-first-context";

export function ChatFirstWorkspaceAppsRail({
  onNavigate,
  collapsed = false,
  layout: controlledLayout,
  onLayoutChange,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  layout?: ChatFirstAppLayoutPreference;
  onLayoutChange?: (layout: ChatFirstAppLayoutPreference) => void;
}) {
  const t = useT();
  const { pane } = useDispatchChatFirstPane();
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false },
  );
  const [localLayout, setLocalLayout] = useState<ChatFirstAppLayoutPreference>(
    () => readChatFirstAppLayout(),
  );
  const layout = controlledLayout ?? localLayout;
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const availableApps = useMemo(
    () =>
      (appsQuery.data ?? [])
        .filter(
          (app) =>
            !app.isDispatch &&
            !app.archived &&
            app.status !== "pending" &&
            !!workspaceAppHref(app),
        )
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    [appsQuery.data],
  );
  const apps = useMemo(() => {
    const ids = orderChatFirstAppIds(
      availableApps.map((app) => app.id),
      layout,
    );
    return ids
      .map((id) => availableApps.find((app) => app.id === id))
      .filter((app): app is WorkspaceAppSummary => Boolean(app))
      .slice(0, 6);
  }, [availableApps, layout]);

  function persistLayout(next: ChatFirstAppLayoutPreference) {
    setLocalLayout(next);
    onLayoutChange?.(next);
    void writeChatFirstAppLayout(next);
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
      availableApps.map((app) => app.id),
      layout,
    );
    const fromIndex = currentOrder.indexOf(draggedAppId);
    const toIndex = currentOrder.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, draggedAppId);
    persistLayout({ ...layout, orderedIds: nextOrder });
  }

  function moveApp(appId: string, direction: -1 | 1) {
    const currentOrder = orderChatFirstAppIds(
      availableApps.map((app) => app.id),
      layout,
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
        className="flex flex-col items-center gap-1 px-1.5 pt-2"
        aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}
      >
        <CreateAppPopover
          align="start"
          trigger={
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={t("dispatch.pages.chatFirstCreateWorkspaceApp")}
              title={t("dispatch.pages.chatFirstCreateWorkspaceApp")}
            >
              <IconPlus size={16} aria-hidden="true" />
            </button>
          }
        />
        {appsQuery.isLoading
          ? [0, 1, 2].map((index) => (
              <Skeleton key={index} className="size-9 rounded-md" />
            ))
          : apps.map((app) => {
              const active = pane?.appId === app.id;
              return (
                <button
                  key={app.id}
                  type="button"
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent(CHAT_FIRST_OPEN_APP_EVENT, {
                        detail: { app: app.id },
                      }),
                    );
                    onNavigate?.();
                  }}
                  aria-label={t("dispatch.pages.chatFirstOpenApp", {
                    name: app.name,
                  })}
                  title={app.name}
                >
                  <AppIcon
                    id={app.id}
                    name={app.name}
                    size="sm"
                    className="size-6 rounded-md"
                  />
                </button>
              );
            })}
        {appsQuery.isError ? (
          <span
            className="size-2 rounded-full bg-destructive"
            title={t("dispatch.pages.chatFirstAppsLoadError")}
            aria-label={t("dispatch.pages.chatFirstAppsLoadError")}
          />
        ) : null}
      </section>
    );
  }

  if (appsQuery.isLoading && !appsQuery.data) {
    return (
      <section
        className="mt-3 border-t border-sidebar-border pt-3"
        aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}
      >
        <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
          <IconApps size={13} aria-hidden="true" />
          <span>{t("dispatch.pages.chatFirstWorkspaceApps")}</span>
        </div>
        <div className="space-y-1 px-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </section>
    );
  }

  if (appsQuery.isError) {
    return (
      <section
        className="mt-3 border-t border-sidebar-border px-2 pt-3"
        aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
          <IconApps size={13} aria-hidden="true" />
          <span>{t("dispatch.pages.chatFirstWorkspaceApps")}</span>
        </div>
        <p className="mt-2 text-xs text-sidebar-foreground/55">
          {t("dispatch.pages.chatFirstAppsLoadError")}
        </p>
        <button
          type="button"
          className="mt-2 text-xs text-sidebar-primary hover:underline"
          onClick={() => void appsQuery.refetch()}
        >
          {t("dispatch.pages.chatFirstRetry")}
        </button>
      </section>
    );
  }

  if (apps.length === 0) {
    return (
      <section
        className="mt-3 border-t border-sidebar-border px-2 pt-3"
        aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
          <IconApps size={13} aria-hidden="true" />
          <span>{t("dispatch.pages.chatFirstWorkspaceApps")}</span>
        </div>
        <p className="mt-2 text-xs text-sidebar-foreground/55">
          {t("dispatch.pages.chatFirstNoWorkspaceApps")}
        </p>
        <CreateAppPopover
          align="start"
          trigger={
            <button
              type="button"
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-sidebar-border px-2 text-xs text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <IconPlus size={13} aria-hidden="true" />
              {t("dispatch.pages.chatFirstCreateApp")}
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section
      className="mt-3 border-t border-sidebar-border pt-3"
      aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}
    >
      <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
        <IconApps size={13} aria-hidden="true" />
        <span>{t("dispatch.pages.chatFirstWorkspaceApps")}</span>
        <span className="ms-auto text-[10px] tabular-nums">{apps.length}</span>
        <CreateAppPopover
          align="end"
          trigger={
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label={t("dispatch.pages.chatFirstCreateWorkspaceApp")}
              title={t("dispatch.pages.chatFirstCreateWorkspaceApp")}
            >
              <IconPlus size={14} aria-hidden="true" />
            </button>
          }
        />
      </div>
      <ul className="space-y-0.5">
        {apps.map((app) => {
          const active = pane?.appId === app.id;
          return (
            <li
              key={app.id}
              draggable
              onDragStart={() => setDraggedAppId(app.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                reorderApps(app.id);
                setDraggedAppId(null);
              }}
              onDragEnd={() => setDraggedAppId(null)}
            >
              <div
                className={cn(
                  "group flex h-9 w-full items-center gap-1 rounded-md px-1 text-start text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
                data-app-id={app.id}
              >
                <IconGripVertical
                  size={13}
                  className="shrink-0 text-sidebar-foreground/35"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-1 text-start"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent(CHAT_FIRST_OPEN_APP_EVENT, {
                        detail: { app: app.id },
                      }),
                    );
                    onNavigate?.();
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveApp(app.id, -1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveApp(app.id, 1);
                    }
                  }}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title={app.name}
                >
                  <AppIcon
                    id={app.id}
                    name={app.name}
                    size="sm"
                    className={cn(
                      "size-5 rounded-md",
                      active && "ring-1 ring-ring/30",
                    )}
                  />
                  <span className="truncate">{app.name}</span>
                </button>
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  aria-label={t(
                    layout.pinnedIds.includes(app.id)
                      ? "dispatch.pages.chatFirstUnpinApp"
                      : "dispatch.pages.chatFirstPinApp",
                    { name: app.name },
                  )}
                  aria-pressed={layout.pinnedIds.includes(app.id)}
                  title={
                    layout.pinnedIds.includes(app.id)
                      ? t("dispatch.pages.chatFirstRemovePinned")
                      : t("dispatch.pages.chatFirstPinTop")
                  }
                  onClick={() => togglePinned(app.id)}
                >
                  <IconPin
                    size={13}
                    strokeWidth={layout.pinnedIds.includes(app.id) ? 2.2 : 1.6}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
