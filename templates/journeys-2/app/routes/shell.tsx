import {
  IconAddressBook, IconBraces, IconBuilding, IconMail, IconPlugConnected, IconRoute,
  IconSettings, IconTarget, IconUsersGroup,
} from "@tabler/icons-react";
import { NavLink, Outlet } from "react-router";

const NAV = [
  { to: "/journeys", label: "Journeys", icon: IconRoute },
  { to: "/emails", label: "Emails", icon: IconMail },
  { to: "/audiences", label: "Audiences", icon: IconUsersGroup },
  { to: "/contacts", label: "Contacts", icon: IconAddressBook },
  { to: "/accounts", label: "Accounts", icon: IconBuilding },
  { to: "/tokens", label: "Tokens", icon: IconBraces },
  { to: "/conversions", label: "Conversions", icon: IconTarget },
  { to: "/connections", label: "Connections", icon: IconPlugConnected },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

export default function Shell() {
  return (
    <div className="flex h-screen min-w-0">
      <nav aria-label="Primary" className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-[hsl(var(--sidebar-background))] p-3">
        <div className="mb-3 flex items-center gap-2 px-2 py-1.5">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">J</span>
          <span className="text-sm font-semibold">Journeys</span>
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? "bg-[hsl(var(--sidebar-accent))] font-medium text-foreground" : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]"}`
            }
          >
            <Icon size={16} stroke={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
