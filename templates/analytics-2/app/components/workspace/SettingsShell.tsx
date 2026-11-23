import { useT } from "@agent-native/core/client/i18n";
import {
  IconAdjustments,
  IconApi,
  IconArchive,
  IconBell,
  IconCalendar,
  IconChevronLeft,
  IconCpu,
  IconDatabase,
  IconKey,
  IconLink,
  IconUserCircle,
  IconLock,
  IconPackage,
  IconPalette,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShield,
  IconShieldLock,
  IconBolt,
  IconSparkles,
  IconStack2,
  IconTag,
  IconTags,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { secondaryFeaturesEnabled } from "@/components/shell/secondary-features";
import { THEME_SETTINGS_SECTION } from "@/components/shell/theme-preference";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { resolveRoutePage } from "./pages";

import "./settings.css";

interface SettingsNavItem {
  adminOnly?: boolean;
  tab: string;
  label: string;
  icon: ReactNode;
}

interface SettingsNavGroup {
  title: string;
  adminOnly?: boolean;
  items: readonly SettingsNavItem[];
}

/** Settings navigation; administrative sections use the effective org role. */
export const NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    title: "Account",
    items: [
      { tab: "profile", label: "Profile", icon: <IconUserCircle size={16} /> },
      {
        tab: "preferences",
        label: "Preferences",
        icon: <IconSettings size={16} />,
      },
      {
        tab: "notifications",
        label: "Notifications",
        icon: <IconBell size={16} />,
      },
      {
        tab: "connected-apps",
        label: "Connected apps",
        icon: <IconLink size={16} />,
      },
      { tab: "api-keys", label: "API keys", icon: <IconKey size={16} /> },
      // Skills is a personal surface: a member manages their own skills, so it
      // belongs here and not in an admin-only group (rows 208-210).
      { tab: "skills", label: "Skills", icon: <IconBolt size={16} /> },
    ],
  },
  {
    title: "Workspace",
    adminOnly: true,
    items: [
      { tab: "general", label: "General", icon: <IconAdjustments size={16} /> },
      {
        tab: "organization",
        label: "Organization",
        icon: <IconTag size={16} />,
      },
      {
        tab: "asset-statuses",
        label: "Asset statuses",
        icon: <IconTags size={16} />,
      },
      {
        tab: "asset-categories",
        label: "Asset categories",
        icon: <IconTag size={16} />,
      },
      { tab: "styling", label: "Styling", icon: <IconPalette size={16} /> },
      {
        tab: "data-sources",
        label: "Data sources",
        icon: <IconDatabase size={16} />,
      },
    ],
  },
  {
    title: "Features",
    adminOnly: true,
    items: [
      { tab: "agent", label: "AI & agents", icon: <IconSparkles size={16} /> },
      {
        tab: "trusted-mode",
        label: "Governed mode",
        icon: <IconShield size={16} />,
      },
      {
        tab: "context-studio",
        label: "Context Studio",
        icon: <IconStack2 size={16} />,
      },
    ],
  },
  {
    title: "Projects",
    adminOnly: true,
    items: [
      { tab: "secrets", label: "Secrets", icon: <IconLock size={16} /> },
      {
        tab: "git-integrations",
        label: "Git integrations",
        icon: <IconApi size={16} />,
      },
      {
        tab: "sharing",
        label: "Sharing settings",
        icon: <IconLink size={16} />,
      },
      {
        tab: "integrations",
        label: "Integrations",
        icon: <IconApi size={16} />,
      },
      {
        tab: "environment",
        label: "Environment",
        icon: <IconPackage size={16} />,
      },
      {
        tab: "compute",
        adminOnly: false,
        label: "Compute",
        icon: <IconCpu size={16} />,
      },
      {
        tab: "scheduled-runs",
        label: "Scheduled runs",
        icon: <IconCalendar size={16} />,
      },
    ],
  },
  {
    title: "Access & Security",
    adminOnly: true,
    items: [
      {
        tab: "users",
        adminOnly: false,
        label: "Users",
        icon: <IconUsers size={16} />,
      },
      {
        tab: "groups",
        adminOnly: false,
        label: "Groups",
        icon: <IconUsersGroup size={16} />,
      },
      {
        tab: "directory-sync",
        label: "Directory sync",
        icon: <IconRefresh size={16} />,
      },
      {
        tab: "audit-logs",
        label: "Audit logs",
        icon: <IconArchive size={16} />,
      },
      { tab: "sso", label: "SSO", icon: <IconLock size={16} /> },
      {
        tab: "project-security",
        label: "Workspace security",
        icon: <IconShieldLock size={16} />,
      },
    ],
  },
];

function navHref(tab: string) {
  return tab === "context-studio" ? "/context-studio" : `/settings/${tab}`;
}

export function SettingsShell({
  activeTab,
  canManageWorkspace,
  children,
}: {
  activeTab: string;
  canManageWorkspace: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const [pendingSection, setPendingSection] = useState<{
    tab: string;
    id: string;
    origin: string;
  } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const arrivedSection = useRef<typeof pendingSection>(null);
  useEffect(() => {
    const target = pendingSection;
    if (!target) return;
    if (target.tab !== activeTab) {
      if (arrivedSection.current === target || target.origin !== activeTab)
        setPendingSection(null);
      return;
    }
    arrivedSection.current = target;
    const deadline = performance.now() + 3000;
    const poll = () => {
      const element =
        document.getElementById(target.id) ??
        document.querySelector(
          `[data-rid="${target.id}"][data-part="settings.row"]`,
        );
      if (element) {
        element.scrollIntoView({ block: "start", behavior: "smooth" });
        setPendingSection(null);
      } else if (performance.now() < deadline) {
        scrollFrame.current = requestAnimationFrame(poll);
      } else {
        setPendingSection(null);
        toast.error(t("analytics.settingsSearch.targetUnavailable"));
      }
    };
    poll();
    return () => {
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
    };
  }, [activeTab, pendingSection, t]);
  const openSearch = (target?: HTMLElement) => {
    opener.current =
      target ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setQuery("");
    setSearchOpen(true);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        searchOpen ||
        document.querySelector('[role="dialog"], [role="menu"]')
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editable =
        target?.isContentEditable ||
        target?.closest('[contenteditable="true"], input, textarea, select');
      const modifier = event.metaKey || event.ctrlKey;
      if (
        (modifier &&
          !event.shiftKey &&
          !event.altKey &&
          ["k", "p"].includes(event.key.toLowerCase())) ||
        (!editable &&
          !modifier &&
          !event.altKey &&
          !event.shiftKey &&
          event.key === "/")
      ) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);
  // A rail item whose view has no registered page leads to a blank frame, so the
  // rail only offers what the app can render. The entries come back as their pages
  // land (AdvertisedViewsGate keeps the no-page set from growing meanwhile).
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (
        !secondaryFeaturesEnabled() &&
        ["directory-sync", "sso"].includes(item.tab)
      )
        return false;
      if ((item.adminOnly ?? group.adminOnly) && !canManageWorkspace)
        return false;
      return Boolean(
        resolveRoutePage({
          id: item.tab === "context-studio" ? "context-studio" : "settings",
          view: item.tab,
        } as Parameters<typeof resolveRoutePage>[0]),
      );
    }),
  })).filter((group) => group.items.length > 0);
  const activeItem = groups
    .flatMap((group) => group.items)
    .find((item) => item.tab === activeTab);
  const sections: Record<
    string,
    { id: string; label: string; adminOnly?: boolean; tab?: string }[]
  > = {
    preferences: [
      {
        id: "settings.preferences.personal-preferences",
        label: t("accountPreferences.personalization"),
      },
      {
        id: "settings.preferences.personal-preferences",
        label: t("accountPreferences.personal"),
      },
      {
        id: "settings.preferences.full-width-cells",
        label: t("editorPreferences.behavior"),
      },
      {
        id: "settings.preferences.full-width-cells",
        label: t("editorPreferences.fullWidthCells"),
      },
      {
        id: "settings.preferences.line-numbers",
        label: t("editorPreferences.lineNumbers"),
      },
      {
        id: "settings.preferences.vim",
        label: t("editorPreferences.vimKeyBindings"),
      },
      {
        id: THEME_SETTINGS_SECTION,
        label: t("analytics.shell.theme"),
      },
    ],
    notifications: [
      {
        id: "settings.notifications.desktop-notifications",
        label: t("analytics.settings.notifications.desktopNotifications"),
      },
    ],
    "data-sources": [
      {
        id: "settings.data-sources.connections",
        label: t("sources.workspaceSettings.groupTitle"),
      },
      {
        id: "settings-data-sources-ssh-key",
        label: t("sources.workspaceSettings.sshKeyTitle"),
      },
    ],
    "git-integrations": [
      {
        id: "settings-integrations-git-package-import",
        label: t("analytics.settingsSearch.gitPackageImport"),
      },
      {
        id: "settings-integrations-git-project-export",
        label: t("analytics.settingsSearch.gitProjectExport"),
      },
      {
        id: "settings-integrations-git-repo-syncing",
        label: t("analytics.settingsSearch.gitRepoSyncing"),
      },
    ],
    organization: [
      {
        id: "settings-organization-auto-archive",
        label: t("analytics.organizationArchive.title"),
      },
      {
        id: "settings-organization-statuses",
        label: t("analytics.settingsSearch.assetStatuses"),
      },
      {
        id: "settings-organization-categories",
        label: t("analytics.settingsSearch.assetCategories"),
      },
    ],
    general: [
      {
        id: "settings-general-sql-formatting",
        label: t("analytics.settingsSearch.sqlFormatting"),
      },
      {
        id: "settings-general-workspace-name",
        label: t("analytics.settings.workspaceName.name"),
      },
    ],
    users: [
      {
        id: "members",
        label: t("analytics.settings.workspace.users"),
      },
      {
        id: "settings.users.role-requests",
        label: t("analytics.settingsSearch.roleRequests"),
        adminOnly: true,
      },
      {
        id: "settings.users.invite-links",
        label: t("analytics.settings.inviteLink.title"),
        adminOnly: true,
      },
    ],
  };
  const searchGroups = groups.map((group) => ({
    ...group,
    items: group.items.flatMap((item) => [
      {
        ...item,
        sectionId: undefined as string | undefined,
        searchLabel: item.label,
      },
      ...(sections[item.tab] ?? [])
        .filter((section) => !section.adminOnly || canManageWorkspace)
        .map((section) => ({
          ...item,
          tab: section.tab ?? item.tab,
          sectionId: section.id,
          searchLabel: `${item.label} > ${section.label}`,
        })),
    ]),
  }));
  const filteredGroups = searchGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.title} ${item.searchLabel}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <div className="settings-shell" data-route-frame="settings">
      <header className="settings-topbar">
        <Link to="/home" className="settings-back">
          <IconChevronLeft size={16} aria-hidden="true" />
          Settings
        </Link>
      </header>
      <div className="settings-split">
        <nav className="settings-nav" aria-label="Settings">
          <button
            type="button"
            className="settings-nav-link w-full"
            aria-label={t("analytics.settingsSearch.open")}
            onClick={(event) => openSearch(event.currentTarget)}
          >
            <IconSearch size={16} aria-hidden="true" />
            {t("analytics.settingsSearch.open")}
          </button>
          {groups.map((group) => (
            <section className="settings-nav-group" key={group.title}>
              <h2 className="settings-nav-title">{group.title}</h2>
              <ul className="settings-nav-list">
                {group.items.map((item) => (
                  <li key={item.tab}>
                    <Link
                      to={navHref(item.tab)}
                      className="settings-nav-link"
                      aria-current={item.tab === activeTab ? "page" : undefined}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="settings-scroll">
          <div className="settings-inner">
            {activeItem ? (
              <h1 className="text-[22px] leading-tight font-semibold">
                {activeItem.label}
              </h1>
            ) : null}
            {children}
          </div>
        </div>
      </div>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current;
            if (!target) return;
            target.focus();
            requestAnimationFrame(() => {
              if (target.isConnected && document.activeElement !== target) {
                target.focus();
              }
            });
          }}
        >
          <DialogTitle>{t("analytics.settingsSearch.open")}</DialogTitle>
          <Command shouldFilter={false}>
            <CommandInput
              autoFocus
              aria-label={t("analytics.settingsSearch.placeholder")}
              placeholder={t("analytics.settingsSearch.placeholder")}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{t("analytics.settingsSearch.empty")}</CommandEmpty>
              {filteredGroups.map((group) => (
                <CommandGroup key={group.title} heading={group.title}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={`${item.sectionId ?? item.tab}-${item.searchLabel}`}
                      value={`${item.sectionId ?? item.tab}-${item.searchLabel}`}
                      onSelect={() => {
                        setSearchOpen(false);
                        setPendingSection(
                          item.sectionId
                            ? {
                                tab: item.tab,
                                id: item.sectionId,
                                origin: activeTab,
                              }
                            : null,
                        );
                        if (item.tab !== activeTab)
                          void navigate(navHref(item.tab));
                      }}
                    >
                      {item.icon}
                      {item.searchLabel}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
