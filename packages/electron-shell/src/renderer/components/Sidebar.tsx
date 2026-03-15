import {
  Mail,
  CalendarDays,
  FileText,
  BarChart2,
  GalleryHorizontal,
  Settings,
  Layers,
  type LucideProps,
} from "lucide-react";
import type { AppDefinition } from "@shared/app-registry";

// Map icon name strings (from app-registry) to Lucide components
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  Mail,
  CalendarDays,
  FileText,
  BarChart2,
  GalleryHorizontal,
  Layers,
  Settings,
};

interface SidebarProps {
  apps: AppDefinition[];
  activeAppId: string;
  onTabChange: (appId: string) => void;
}

export default function Sidebar({
  apps,
  activeAppId,
  onTabChange,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Windows/Linux custom traffic lights */}
      <div className="win-controls">
        <button
          className="win-btn win-btn--close"
          onClick={() => window.electronAPI?.windowControls.close()}
          title="Close"
        />
        <button
          className="win-btn win-btn--minimize"
          onClick={() => window.electronAPI?.windowControls.minimize()}
          title="Minimize"
        />
        <button
          className="win-btn win-btn--maximize"
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
          />
        ))}
      </nav>

      {/* Settings pinned at the bottom */}
      <div className="sidebar-footer">
        <SidebarIconButton icon={Settings} label="Settings" onClick={() => {}} />
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
  const Icon = ICON_MAP[app.icon] ?? Layers;

  return (
    <button
      className={`sidebar-item${isActive ? " sidebar-item--active" : ""}`}
      style={
        {
          "--item-accent": app.color,
        } as React.CSSProperties
      }
      onClick={onClick}
      title={app.description}
      aria-label={app.name}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="icon-wrapper">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="item-label">{app.name}</span>
    </button>
  );
}

// ─── Generic icon-only button (for settings, etc.) ────────────────────────────

interface SidebarIconButtonProps {
  icon: React.ComponentType<LucideProps>;
  label: string;
  onClick: () => void;
}

function SidebarIconButton({ icon: Icon, label, onClick }: SidebarIconButtonProps) {
  return (
    <button
      className="sidebar-item"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span className="icon-wrapper">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="item-label">{label}</span>
    </button>
  );
}
