import {
  CHAT_FIRST_OPEN_APP_EVENT,
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  type ChatFirstAppLayoutPreference,
} from "@agent-native/core/client/agent-chat";
import type { AppConfig } from "@shared/app-registry";
import {
  IconApps,
  IconBrandChrome,
  IconBrandJira,
  IconBrain,
  IconCalendar,
  IconChartBar,
  IconClock,
  IconCode,
  IconFileText,
  IconFolder,
  IconGripVertical,
  IconLayoutBoard,
  IconListCheck,
  IconMail,
  IconMessageCircle,
  IconPhoto,
  IconPin,
  IconPlus,
  IconPlugConnected,
  IconPresentation,
  IconRoute,
  IconSettings,
  IconStack2,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";

const APP_ICON_MAP: Record<string, typeof IconStack2> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  LayoutBoard: IconLayoutBoard,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  BrandJira: IconBrandJira,
  Users: IconUsers,
  Code: IconCode,
  MessageCircle: IconMessageCircle,
  Route: IconRoute,
  Brain: IconBrain,
  Globe: IconBrandChrome,
  Photo: IconPhoto,
  ListCheck: IconListCheck,
  Folder: IconFolder,
  Settings: IconSettings,
};

function AppIcon({ app, size = 15 }: { app: AppConfig; size?: number }) {
  const Icon = APP_ICON_MAP[app.icon] ?? IconStack2;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function NavigationItem({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`code-agents-nav-link${active ? " code-agents-nav-link--active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export default function DesktopChatFirstRail({
  apps,
  activeAppId,
  notice,
  onCreateApp,
}: {
  apps: AppConfig[];
  activeAppId?: string;
  notice?: string | null;
  onCreateApp?: () => void;
}) {
  const [layout, setLayout] = useState<ChatFirstAppLayoutPreference>(() => ({
    ...readChatFirstAppLayout(),
  }));
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const availableApps = useMemo(
    () => apps.filter((app) => app.enabled && app.id !== "agent"),
    [apps],
  );
  const visibleApps = useMemo(() => {
    const appsById = new Map(availableApps.map((app) => [app.id, app]));
    return orderChatFirstAppIds(
      availableApps.map((app) => app.id),
      layout,
    )
      .map((id) => appsById.get(id))
      .filter((app): app is AppConfig => Boolean(app))
      .slice(0, 6);
  }, [availableApps, layout]);
  const hasDispatch = availableApps.some((app) => app.id === "dispatch");

  function persistLayout(next: ChatFirstAppLayoutPreference) {
    setLayout(next);
    const result = writeChatFirstAppLayout(next);
    setOrderError(
      result.ok ? null : "App order could not be saved on this device.",
    );
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

  return (
    <div className="desktop-chat-first-apps" aria-label="Workspace apps">
      <div className="desktop-chat-first-apps__label">
        <IconApps size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>Apps</span>
        <span className="desktop-chat-first-apps__count">
          {visibleApps.length}
        </span>
        {onCreateApp ? (
          <button
            type="button"
            className="desktop-chat-first-apps__create"
            onClick={onCreateApp}
            aria-label="Create workspace app"
            title="Create workspace app"
          >
            <IconPlus size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {visibleApps.length === 0 ? (
        <>
          <p className="desktop-chat-first-apps__empty">No apps enabled</p>
          {onCreateApp ? (
            <button
              type="button"
              className="desktop-chat-first-apps__create-label"
              onClick={onCreateApp}
            >
              <IconPlus size={13} strokeWidth={1.8} aria-hidden="true" />
              Create app
            </button>
          ) : null}
        </>
      ) : (
        visibleApps.map((app) => (
          <div
            key={app.id}
            className={[
              "desktop-chat-first-app",
              app.id === activeAppId ? "desktop-chat-first-app--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable
            data-app-id={app.id}
            onDragStart={() => setDraggedAppId(app.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              reorderApps(app.id);
              setDraggedAppId(null);
            }}
            onDragEnd={() => setDraggedAppId(null)}
          >
            <IconGripVertical
              className="desktop-chat-first-app__grip"
              size={13}
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <button
              type="button"
              className="desktop-chat-first-app__open"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent(CHAT_FIRST_OPEN_APP_EVENT, {
                    detail: { app: app.id },
                  }),
                );
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
              <span className="desktop-chat-first-app__icon">
                <AppIcon app={app} />
              </span>
              <span className="desktop-chat-first-app__name">{app.name}</span>
            </button>
            <button
              type="button"
              className="desktop-chat-first-app__pin"
              aria-label={
                layout.pinnedIds.includes(app.id)
                  ? `Unpin ${app.name}`
                  : `Pin ${app.name}`
              }
              aria-pressed={layout.pinnedIds.includes(app.id)}
              title={
                layout.pinnedIds.includes(app.id)
                  ? "Remove from pinned apps"
                  : "Pin app to the top"
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
        ))
      )}
      {!hasDispatch && (
        <p className="desktop-chat-first-apps__hint">
          Enable Dispatch for integrations and schedules.
        </p>
      )}
      {notice ? (
        <p className="desktop-chat-first-apps__notice" role="status">
          {notice}
        </p>
      ) : null}
      {orderError ? (
        <p className="desktop-chat-first-apps__notice" role="status">
          {orderError}
        </p>
      ) : null}
    </div>
  );
}

export { AppIcon as DesktopChatFirstAppIcon };

export function DesktopChatFirstNavigation({
  onOpenApp,
  activeKind,
  onSelectKind,
}: {
  onOpenApp: (appId: string, path?: string) => void;
  activeKind?: "agent" | "code";
  onSelectKind?: (kind: "agent" | "code") => void;
}) {
  return (
    <>
      <NavigationItem
        label="Integrations"
        onClick={() => {
          onSelectKind?.("code");
          onOpenApp("dispatch", "/admin/integrations");
        }}
      >
        <IconPlugConnected size={15} strokeWidth={1.8} aria-hidden="true" />
      </NavigationItem>
      <NavigationItem
        label="Scheduled"
        onClick={() => {
          onSelectKind?.("code");
          onOpenApp("dispatch", "/admin/automations");
        }}
      >
        <IconClock size={15} strokeWidth={1.8} aria-hidden="true" />
      </NavigationItem>
      <NavigationItem
        label="Agent chat"
        active={activeKind === "agent"}
        onClick={() => onSelectKind?.("agent")}
      >
        <IconMessageCircle size={15} strokeWidth={1.8} aria-hidden="true" />
      </NavigationItem>
      <NavigationItem
        label="Code work"
        active={activeKind === "code"}
        onClick={() => onSelectKind?.("code")}
      >
        <IconCode size={15} strokeWidth={1.8} aria-hidden="true" />
      </NavigationItem>
    </>
  );
}
