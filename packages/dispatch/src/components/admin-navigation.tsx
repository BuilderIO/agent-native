import { useT } from "@agent-native/core/client/i18n";
import {
  IconActivity,
  IconArrowUpRight,
  IconBrain,
  IconBrandTelegram,
  IconChartBar,
  IconFingerprint,
  IconHistory,
  IconKey,
  IconLayersSubtract,
  IconMail,
  IconMessages,
  IconPlugConnected,
  IconPuzzle,
  IconSettingsAutomation,
  IconShield,
  IconShieldCheck,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router";

import { cn } from "../lib/utils";
import { DISPATCH_DOCS, DocsLink } from "./docs-link";
import { useDispatchExtensions, type DispatchNavItem } from "./layout/Layout";

export interface AdminNavGroup {
  id: string;
  label: string;
  labelKey: string;
  items: readonly DispatchNavItem[];
}

const BUILT_IN_ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    labelKey: "dispatch.pages.adminWorkspace",
    items: [
      {
        id: "admin-overview",
        to: "/admin",
        label: "Overview",
        icon: IconShield,
      },
      {
        id: "admin-resources",
        to: "/admin/workspace",
        label: "Resources",
        icon: IconLayersSubtract,
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    labelKey: "dispatch.pages.adminOperations",
    items: [
      {
        id: "operations",
        to: "/admin/operations",
        label: "Operations",
        icon: IconActivity,
      },
      {
        id: "metrics",
        to: "/admin/metrics",
        label: "Metrics",
        icon: IconChartBar,
      },
      {
        id: "audit",
        to: "/admin/audit",
        label: "Audit",
        icon: IconHistory,
      },
      {
        id: "thread-debug",
        to: "/admin/thread-debug",
        label: "Thread Debug",
        icon: IconMessages,
      },
    ],
  },
  {
    id: "automation",
    label: "Automation & delivery",
    labelKey: "dispatch.pages.adminAutomation",
    items: [
      {
        id: "automations",
        to: "/admin/automations",
        label: "Automations",
        icon: IconSettingsAutomation,
      },
      {
        id: "approvals",
        to: "/admin/approvals",
        label: "Approvals",
        icon: IconShieldCheck,
      },
      {
        id: "destinations",
        to: "/admin/destinations",
        label: "Destinations",
        icon: IconArrowUpRight,
      },
      {
        id: "transactional-email",
        to: "/admin/transactional-email",
        label: "Transactional email",
        icon: IconMail,
      },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    labelKey: "dispatch.pages.adminConnections",
    items: [
      {
        id: "integrations",
        to: "/admin/integrations",
        label: "Integrations",
        icon: IconPuzzle,
      },
      {
        id: "vault",
        to: "/admin/vault",
        label: "Vault",
        icon: IconKey,
      },
      {
        id: "messaging",
        to: "/admin/messaging",
        label: "Messaging",
        icon: IconBrandTelegram,
      },
      {
        id: "identities",
        to: "/admin/identities",
        label: "Identities",
        icon: IconFingerprint,
      },
    ],
  },
  {
    id: "agent-platform",
    label: "Agent platform",
    labelKey: "dispatch.pages.adminAgentPlatform",
    items: [
      {
        id: "agents",
        to: "/admin/agents",
        label: "Agents",
        icon: IconPlugConnected,
      },
      {
        id: "dreams",
        to: "/admin/dreams",
        label: "Dreams",
        icon: IconBrain,
      },
    ],
  },
];

function itemLabel(t: ReturnType<typeof useT>, item: DispatchNavItem) {
  return t(`dispatch.nav.${item.id}`, { defaultValue: item.label });
}

function AdminNavLink({
  item,
  onNavigate,
}: {
  item: DispatchNavItem;
  onNavigate?: () => void;
}) {
  const t = useT();
  const to = item.adminTo ?? item.to;
  const label = itemLabel(t, item);
  const Icon = item.icon;

  return (
    <li>
      <NavLink
        to={to}
        end={item.id === "admin-overview"}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "flex min-h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
            isActive
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )
        }
      >
        {Icon ? <Icon size={15} className="shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </NavLink>
    </li>
  );
}

export function AdminShell({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate?: () => void;
}) {
  const t = useT();
  const groups = useAdminNavGroups();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (!normalizedQuery) return true;
            const label = itemLabel(t, item).toLowerCase();
            return `${label} ${group.label.toLowerCase()}`.includes(
              normalizedQuery,
            );
          }),
        }))
        .filter((group) => group.items.length > 0),
    [groups, normalizedQuery, t],
  );

  return (
    <div
      className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]"
      data-dispatch-admin-shell
    >
      <aside className="min-w-0 border-b pb-5 lg:sticky lg:top-2 lg:self-start lg:border-b-0">
        <div className="flex items-center gap-1 px-2">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Search admin"
              aria-label="Search admin"
              className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear admin search"
                className="absolute end-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              >
                <IconX className="size-3.5" />
              </button>
            ) : null}
          </div>
          <DocsLink
            href={DISPATCH_DOCS.dispatch}
            label="Open Dispatch admin documentation"
          />
        </div>

        <nav
          aria-label={t("dispatch.pages.adminNavigation", {
            defaultValue: "Admin navigation",
          })}
          className="mt-5 space-y-5"
        >
          {visibleGroups.map((group) => (
            <section key={group.id}>
              <h2 className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t(group.labelKey, { defaultValue: group.label })}
              </h2>
              <ul className="mt-1 space-y-0.5">
                {group.items.map((item) => (
                  <AdminNavLink
                    key={item.id}
                    item={item}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </section>
          ))}
          {visibleGroups.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matching admin pages
            </p>
          ) : null}
        </nav>
      </aside>

      <section className="min-w-0" data-dispatch-admin-content>
        {children}
      </section>
    </div>
  );
}

export { BUILT_IN_ADMIN_NAV_GROUPS };

export function useAdminNavGroups(): readonly AdminNavGroup[] {
  const extensions = useDispatchExtensions();
  const extensionItems = (extensions?.navItems ?? []).filter(
    (item) => item.section === "operations",
  );

  return extensionItems.length
    ? [
        ...BUILT_IN_ADMIN_NAV_GROUPS,
        {
          id: "workspace-extensions",
          label: "Workspace extensions",
          labelKey: "dispatch.pages.adminWorkspaceExtensions",
          items: extensionItems,
        },
      ]
    : BUILT_IN_ADMIN_NAV_GROUPS;
}
