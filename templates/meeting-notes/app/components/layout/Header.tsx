import { useState } from "react";
import { Link, useLocation } from "react-router";
import {
  IconBuilding,
  IconCalendarEvent,
  IconMenu2,
  IconSettings,
  IconTemplate,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { AgentToggleButton, appPath } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "Notes",
  "/meetings": "Meetings",
  "/people": "People",
  "/companies": "Companies",
  "/templates": "Templates",
  "/settings": "Settings",
  "/extensions": "Extensions",
};

const navItems = [
  { href: "/meetings", label: "Meetings", icon: IconCalendarEvent },
  { href: "/people", label: "People", icon: IconUsers },
  { href: "/companies", label: "Companies", icon: IconBuilding },
  { href: "/templates", label: "Templates", icon: IconTemplate },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/extensions")) return "Extensions";
  return "Notes";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <button
        onClick={() => setMenuOpen(true)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Open menu"
      >
        <IconMenu2 className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {title ?? (
          <span className="truncate text-sm font-semibold text-foreground">
            {resolveTitle(location.pathname)}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-border bg-background shadow-xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
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
                <span className="text-sm font-semibold text-foreground">
                  Meeting Notes
                </span>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close menu"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <nav className="border-b border-border p-3" aria-label="Main">
              <div className="space-y-1">
                {navItems.map((item) => {
                  const active =
                    location.pathname === item.href ||
                    (item.href === "/meetings" && location.pathname === "/") ||
                    (item.href !== "/meetings" &&
                      location.pathname.startsWith(`${item.href}/`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium ${
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
            <div className="p-3">
              <ExtensionsSidebarSection />
            </div>
          </div>
        </>
      )}
    </header>
  );
}
