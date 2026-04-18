import { ReactNode, useMemo } from "react";
import { NavLink, useLocation } from "react-router";
import {
  IconBuilding,
  IconUsers,
  IconPlug,
  IconKey,
  IconPalette,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface SettingsTab {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  description?: string;
}

const TABS: SettingsTab[] = [
  {
    key: "workspace",
    label: "Workspace",
    icon: IconBuilding,
    path: "/settings",
    description: "Name, default visibility, trash retention",
  },
  {
    key: "members",
    label: "Members",
    icon: IconUsers,
    path: "/settings/members",
    description: "Invite teammates and manage roles",
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: IconPlug,
    path: "/settings/integrations",
    description: "Zoom Cloud, meeting bot, CRM sync",
  },
  {
    key: "api-keys",
    label: "API keys",
    icon: IconKey,
    path: "/settings/api-keys",
    description: "OpenAI, Deepgram, Recall.ai",
  },
  {
    key: "branding",
    label: "Branding",
    icon: IconPalette,
    path: "/settings/branding",
    description: "Logo and share-page accent",
  },
];

interface SettingsShellProps {
  children?: ReactNode;
  title?: string;
  description?: string;
  defaultTab?: string;
}

export function SettingsShell({
  children,
  title,
  description,
  defaultTab,
}: SettingsShellProps) {
  const location = useLocation();
  const activeTab = useMemo(
    () =>
      TABS.slice()
        .sort((a, b) => b.path.length - a.path.length)
        .find((t) =>
          t.path === "/settings"
            ? location.pathname === "/settings" ||
              location.pathname === "/settings/"
            : location.pathname.startsWith(t.path),
        ),
    [location.pathname],
  );

  const heading = title ?? activeTab?.label ?? "Settings";
  const sub = description ?? activeTab?.description ?? "";

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <aside className="w-60 shrink-0 border-r border-border bg-sidebar px-3 py-4">
        <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Settings
        </h2>
        <nav className="mt-2 space-y-0.5">
          {TABS.map(({ key, label, icon: Icon, path }) => {
            const isActive = activeTab?.key === key;
            return (
              <NavLink
                key={key}
                to={path}
                end={path === "/settings"}
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="border-b border-border px-8 py-5">
          <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
          {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
        </header>
        <div className="flex-1 px-8 py-6 max-w-3xl w-full">{children}</div>
      </div>
    </div>
  );
}
