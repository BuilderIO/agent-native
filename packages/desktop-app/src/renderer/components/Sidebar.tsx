import type { AppDefinition } from "@shared/app-registry";
import {
  IconMail,
  IconCalendar,
  IconFileText,
  IconChartBar,
  IconPresentation,
  IconStack2,
  IconBrandJira,
  IconClipboardList,
  IconUsers,
  IconCode,
  IconMessageCircle,
  IconSettings,
  IconScreenShare,
  IconBrush,
  IconBrain,
  IconPhone,
  IconNote,
  IconMicrophone,
  IconCalendarTime,
  IconLayoutBoard,
  IconPlus,
  IconRoute,
  IconWorld,
  IconPhoto,
} from "@tabler/icons-react";

import { UpdateIndicator } from "./UpdateIndicator.js";

const agentNativeIconUrl = new URL(
  "../assets/agent-native-icon-dark.svg",
  import.meta.url,
).href;

// Map icon name strings (from shared-app-config) to Tabler components
const ICON_MAP: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  LayoutBoard: IconLayoutBoard,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  BrandJira: IconBrandJira,
  ClipboardList: IconClipboardList,
  Users: IconUsers,
  Code: IconCode,
  MessageCircle: IconMessageCircle,
  Route: IconRoute,
  ScreenShare: IconScreenShare,
  Brush: IconBrush,
  Brain: IconBrain,
  Phone: IconPhone,
  Note: IconNote,
  Microphone: IconMicrophone,
  CalendarTime: IconCalendarTime,
  Globe: IconWorld,
  Photo: IconPhoto,
};

interface SidebarProps {
  apps: AppDefinition[];
  activeAppId: string;
  onTabChange: (appId: string) => void;
  onAppContextMenu?: (appId: string) => void;
  onAddAppClick?: () => void;
  isCodeAgentsActive?: boolean;
  onCodeAgentsClick?: () => void;
  onSettingsClick?: () => void;
}

export default function Sidebar({
  apps,
  activeAppId,
  onTabChange,
  onAppContextMenu,
  onAddAppClick,
  isCodeAgentsActive = false,
  onCodeAgentsClick,
  onSettingsClick,
}: SidebarProps) {
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
        {apps.map((app) => (
          <SidebarItem
            key={app.id}
            app={app}
            isActive={app.id === activeAppId}
            onClick={() => onTabChange(app.id)}
            onContextMenu={() => onAppContextMenu?.(app.id)}
          />
        ))}
        {onAddAppClick && <SidebarAddButton onClick={onAddAppClick} />}
      </nav>

      {/* Footer: update indicator (when relevant) + settings */}
      <div className="sidebar-footer">
        <UpdateIndicator />
        {onCodeAgentsClick && (
          <button
            className={`sidebar-item${isCodeAgentsActive ? " sidebar-item--active" : ""}`}
            tabIndex={-1}
            onClick={onCodeAgentsClick}
            title="Agent"
            aria-label="Agent"
            aria-current={isCodeAgentsActive ? "page" : undefined}
          >
            <span className="icon-wrapper">
              <img
                src={agentNativeIconUrl}
                alt=""
                aria-hidden="true"
                className="sidebar-agent-native-icon"
              />
            </span>
            <span className="item-label">Agent</span>
          </button>
        )}
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

function SidebarAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="sidebar-item sidebar-item--add"
      tabIndex={-1}
      onClick={onClick}
      title="Create a new app"
      aria-label="Create a new app"
    >
      <span className="icon-wrapper">
        <IconPlus size={18} strokeWidth={1.75} />
      </span>
      <span className="item-label">New</span>
    </button>
  );
}

// ─── Individual tab item ──────────────────────────────────────────────────────

interface SidebarItemProps {
  app: AppDefinition;
  isActive: boolean;
  onClick: () => void;
  onContextMenu?: () => void;
}

function SidebarItem({
  app,
  isActive,
  onClick,
  onContextMenu,
}: SidebarItemProps) {
  const Icon = ICON_MAP[app.icon] ?? IconStack2;

  return (
    <button
      className={`sidebar-item${isActive ? " sidebar-item--active" : ""}`}
      tabIndex={-1}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.();
      }}
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
