import {
  IconMail,
  IconCalendar,
  IconFileText,
  IconChartBar,
  IconPresentation,
  IconStack2,
  IconVideo,
  IconBrandJira,
  IconClipboardList,
  IconUsers,
  IconCode,
  IconMessageCircle,
  IconSettings,
  IconScreenShare,
  IconBrush,
} from "@tabler/icons-react";
import type { AppDefinition } from "@shared/app-registry";
import { UpdateIndicator } from "./UpdateIndicator.js";

// Map icon name strings (from shared-app-config) to Tabler components
const ICON_MAP: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  Video: IconVideo,
  BrandJira: IconBrandJira,
  ClipboardList: IconClipboardList,
  Users: IconUsers,
  Code: IconCode,
  MessageCircle: IconMessageCircle,
  ScreenShare: IconScreenShare,
  Brush: IconBrush,
};

interface SidebarProps {
  apps: AppDefinition[];
  activeAppId: string;
  onTabChange: (appId: string) => void;
  onSettingsClick?: () => void;
}

export default function Sidebar({
  apps,
  activeAppId,
  onTabChange,
  onSettingsClick,
}: SidebarProps) {
  const pinnedBottomOrder = ["dispatch", "starter"];
  const pinnedBottom = pinnedBottomOrder
    .map((id) => apps.find((app) => app.id === id))
    .filter((app): app is AppDefinition => !!app);
  const mainApps = apps.filter((app) => !pinnedBottomOrder.includes(app.id));
  const orderedApps = [...mainApps, ...pinnedBottom];

  return (
    <aside className="sidebar">
      {/* Windows/Linux custom traffic lights */}
      <div className="win-controls">
        <button
          className="win-btn win-btn--close"
          tabIndex={-1}
          onClick={() => window.electronAPI?.windowControls.close()}
          title="Close"
        />
        <button
          className="win-btn win-btn--minimize"
          tabIndex={-1}
          onClick={() => window.electronAPI?.windowControls.minimize()}
          title="Minimize"
        />
        <button
          className="win-btn win-btn--maximize"
          tabIndex={-1}
          onClick={() => window.electronAPI?.windowControls.maximize()}
          title="Maximize"
        />
      </div>

      {/* App tabs */}
      <nav className="sidebar-nav">
        {orderedApps.map((app) => (
          <SidebarItem
            key={app.id}
            app={app}
            isActive={app.id === activeAppId}
            onClick={() => onTabChange(app.id)}
          />
        ))}
      </nav>

      {/* Footer: update indicator (when relevant) + settings */}
      <div className="sidebar-footer">
        <UpdateIndicator />
        {onSettingsClick && (
          <button
            className="sidebar-item"
            tabIndex={-1}
            onClick={onSettingsClick}
            title="App Settings"
            aria-label="Settings"
          >
            <span className="icon-wrapper">
              <IconSettings size={18} strokeWidth={1.75} />
            </span>
            <span className="item-label">Settings</span>
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── Individual tab item ──────────────────────────────────────────────────────

interface SidebarItemProps {
  app: AppDefinition;
  isActive: boolean;
  onClick: () => void;
}

function SidebarItem({ app, isActive, onClick }: SidebarItemProps) {
  const Icon = ICON_MAP[app.icon] ?? IconStack2;

  return (
    <button
      className={`sidebar-item${isActive ? " sidebar-item--active" : ""}`}
      tabIndex={-1}
      onClick={onClick}
      title={app.description}
      aria-label={app.name}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="icon-wrapper">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="item-label">{app.name}</span>
    </button>
  );
}
