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
} from "@tabler/icons-react";
import { type ReactNode } from "react";
import { NavLink } from "react-router";

import { cn } from "../lib/utils";
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

  return (
    <div
      className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]"
      data-dispatch-admin-shell
    >
      <aside className="min-w-0 border-b pb-5 lg:sticky lg:top-2 lg:self-start lg:border-b-0 lg:border-e lg:pe-6">
        <div className="px-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("dispatch.nav.admin", { defaultValue: "Admin" })}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("dispatch.pages.adminDescription", {
              defaultValue: "Workspace controls and operations",
            })}
          </p>
        </div>

        <nav
          aria-label={t("dispatch.pages.adminNavigation", {
            defaultValue: "Admin navigation",
          })}
          className="mt-5 space-y-5"
        >
          {groups.map((group) => (
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
