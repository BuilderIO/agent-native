import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconVideo,
  IconComponents,
  IconPalette,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";

const navItems = [
  { icon: IconVideo, labelKey: "navigation.animations", href: "/" },
  {
    icon: IconComponents,
    labelKey: "navigation.components",
    href: "/components",
  },
  {
    icon: IconPalette,
    labelKey: "navigation.designSystems",
    href: "/design-systems",
  },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
  { icon: IconUsers, labelKey: "navigation.team", href: "/team" },
];

export function NavSidebar() {
  const location = useLocation();
  const t = useT();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 border-b border-border">
        <img
          src={appPath("/agent-native-icon-light.svg")}
          alt=""
          aria-hidden="true"
          className="block h-4 w-auto shrink-0 dark:hidden"
        />
        <img
          src={appPath("/agent-native-icon-dark.svg")}
          alt=""
          aria-hidden="true"
          className="hidden h-4 w-auto shrink-0 dark:block"
        />
        <span className="text-sm font-semibold tracking-tight">
          {t("navigation.brand")}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? !location.pathname.startsWith("/components") &&
                !location.pathname.startsWith("/design-systems") &&
                !location.pathname.startsWith("/settings") &&
                !location.pathname.startsWith("/team") &&
                !location.pathname.startsWith("/extensions")
              : location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-2 py-2">
        <ExtensionsSidebarSection />
      </div>

      <div className="border-t border-border px-3 py-2 space-y-2">
        <DevDatabaseLink />
        <FeedbackButton />
        <OrgSwitcher />
      </div>
    </aside>
  );
}
