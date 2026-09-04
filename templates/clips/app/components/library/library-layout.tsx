import {
  AgentSidebar,
  AgentToggleButton,
} from "@agent-native/core/client/agent-chat";
import { appPath } from "@agent-native/core/client/api-path";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  InvitationBanner,
  OrgSwitcher,
  useOrgRole,
} from "@agent-native/core/client/org";
import {
  AgentNativeIcon,
  EnvironmentBadge,
} from "@agent-native/core/client/ui";
import {
  IconInbox,
  IconArchive,
  IconCalendar,
  IconMicrophone2,
  IconTrash,
  IconUsersGroup,
  IconBrandChrome,
  IconDownload,
  IconMenu2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRight,
  IconShare,
  IconDots,
  IconEdit,
} from "@tabler/icons-react";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import {
  useFolders,
  useSpaces,
  useOrganizations,
  useRecordingsCount,
} from "@/hooks/use-library";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefetchVideoStorageStatus } from "@/hooks/use-video-storage-status";
import {
  clipsChromeExtensionUrl,
  useClipsChromeExtensionEnabled,
} from "@/lib/capture-install-options";
import { cn } from "@/lib/utils";

import { FolderTree, type FolderNode } from "./folder-tree";
import { PageHeaderSlotProvider } from "./page-header";
import { SpaceDialogs } from "./space-dialogs";

interface LibraryLayoutProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "clips:left-sidebar-collapsed";

function readSidebarCollapsedPreference() {
  if (typeof window === "undefined") return false;

  try {
    return (
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function ClipsAgentToggleButton() {
  return (
    <AgentToggleButton
      showWhenOpen
      icon={<IconLayoutSidebarRight className="size-5" aria-hidden />}
    />
  );
}

export function LibraryLayout({ children }: LibraryLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  // Bind chat to the currently-open recording (`/r/:id`). Library, spaces,
  // meetings, dictate, and settings stay unscoped — those are list-y views
  // where deck-style "this recording" framing doesn't apply.
  const recordingScope = useMemo(() => {
    const match = location.pathname.match(/^\/r\/([^/]+)/);
    const recordingId = match?.[1];
    if (!recordingId) return null;
    return { type: "recording" as const, id: recordingId };
  }, [location.pathname]);
  const isMobile = useIsMobile();
  const { folderId, spaceId } = useParams<{
    folderId?: string;
    spaceId?: string;
  }>();

  const { shouldShowSidebarLink } = useDesktopPromo();
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();
  usePrefetchVideoStorageStatus();

  const { org, canManageOrg } = useOrgRole();
  const hasActiveOrg = Boolean(org?.orgId);
  const { data: organizations } = useOrganizations({ enabled: hasActiveOrg });
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;

  const { data: spaces, refetch: refetchSpaces } = useSpaces(
    currentOrganizationId,
    {
      enabled: hasActiveOrg && Boolean(currentOrganizationId),
    },
  );
  const { data: libFolders } = useFolders(
    {
      organizationId: currentOrganizationId,
    },
    { enabled: hasActiveOrg && Boolean(currentOrganizationId) },
  );

  // Clip count for the "Library" nav item — count-only, no row payload or
  // title polling across the app shell.
  const { data: libraryCount } = useRecordingsCount({ view: "library" });
  const { data: sharedCount } = useRecordingsCount({ view: "shared" });

  const libFolderList: FolderNode[] = useMemo(
    () =>
      (libFolders?.folders ?? [])
        .filter((f: any) => !f.spaceId)
        .map((f: any) => ({
          id: f.id,
          parentId: f.parentId ?? null,
          spaceId: f.spaceId ?? null,
          name: f.name,
        })),
    [libFolders],
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readSidebarCollapsedPreference,
  );
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const showCollapsedSidebar = sidebarCollapsed && !isMobile;
  const workspaceUtilityLinks = [
    ...(chromeExtensionEnabled && clipsChromeExtensionUrl
      ? [
          {
            id: "chrome-extension",
            label: t("captureInstall.chromeTitle"),
            href: clipsChromeExtensionUrl,
            icon: <IconBrandChrome />,
            external: true,
          },
        ]
      : []),
    ...(shouldShowSidebarLink
      ? [
          {
            id: "desktop-app",
            label: t("navigation.desktopCta"),
            href: appPath("/download"),
            icon: <IconDownload />,
          },
        ]
      : []),
  ];
  const collapseButton = !isMobile ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={
            showCollapsedSidebar
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {showCollapsedSidebar ? (
            <IconLayoutSidebarLeftExpand className="size-4" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {showCollapsedSidebar
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  // Routes whose page renders its own h-12 toolbar. Layout still mounts Sidebar
  // + AgentSidebar, but skips its own header so there's no double-header.
  const pageOwnsToolbar =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        sidebarCollapsed ? "true" : "false",
      );
    } catch {
      // coercion-ok: Sidebar preference is optional when storage is unavailable.
    }
  }, [sidebarCollapsed]);

  const [deleteSpaceId, setDeleteSpaceId] = useState<string | null>(null);
  const [deleteSpaceName, setDeleteSpaceName] = useState("");
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const [renameSpaceValue, setRenameSpaceValue] = useState("");
  const navItems: {
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    match: (path: string) => boolean;
    count?: number;
  }[] = [
    {
      to: "/library",
      label: t("navigation.library"),
      icon: IconInbox,
      match: (p) => p.startsWith("/library"),
      count: libraryCount,
    },
    {
      to: "/shared",
      label: t("navigation.sharedWithMe"),
      icon: IconShare,
      match: (p) => p === "/shared",
      count: sharedCount,
    },
    {
      to: "/spaces",
      label: t("navigation.spaces"),
      icon: IconUsersGroup,
      match: (p) => p.startsWith("/spaces"),
    },
    {
      to: "/meetings",
      label: t("navigation.meetings"),
      icon: IconCalendar,
      match: (p) => p.startsWith("/meetings"),
    },
    {
      to: "/dictate",
      label: t("navigation.dictate"),
      icon: IconMicrophone2,
      match: (p) => p.startsWith("/dictate"),
    },
    {
      to: "/archive",
      label: t("navigation.archive"),
      icon: IconArchive,
      match: (p) => p.startsWith("/archive"),
    },
    {
      to: "/trash",
      label: t("navigation.trash"),
      icon: IconTrash,
      match: (p) => p.startsWith("/trash"),
    },
  ];

  const primaryNavItems = navItems.filter(
    ({ to }) => to !== "/archive" && to !== "/trash",
  );
  const lifecycleNavItems = navItems.filter(
    ({ to }) => to === "/archive" || to === "/trash",
  );

  const renderExpandedNavItem = ({
    to,
    label,
    icon: Icon,
    match,
    count,
  }: (typeof navItems)[number]) => {
    const active = match(location.pathname);

    return (
      <div
        key={to}
        className={cn(
          "group flex items-center rounded",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground hover:bg-accent/60",
        )}
      >
        <NavLink
          to={to}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs"
        >
          <Icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <span
              className={cn(
                "shrink-0 tabular-nums text-[11px]",
                active ? "text-primary/80" : "text-muted-foreground",
              )}
            >
              {count}
            </span>
          )}
        </NavLink>
      </div>
    );
  };

  const renderCollapsedNavItem = ({
    to,
    label,
    icon: Icon,
    match,
  }: (typeof navItems)[number]) => {
    const active = match(location.pathname);

    return (
      <Tooltip key={to}>
        <TooltipTrigger asChild>
          <NavLink
            to={to}
            aria-label={label}
            className={cn(
              "flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              active &&
                "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
            )}
          >
            <Icon className="size-4" />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="agent-layout-shell flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left sidebar */}
      <aside
        className={cn(
          "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 flex h-full w-[260px] flex-col overflow-hidden border-e border-border bg-sidebar transition-[width,transform] duration-200 ease-out md:static md:z-auto",
          showCollapsedSidebar && "md:w-14",
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full rtl:translate-x-full md:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border",
            showCollapsedSidebar
              ? "flex-col justify-center gap-0.5 px-2"
              : "gap-2 px-4",
          )}
        >
          <NavLink
            to="/library"
            aria-label={t("navigation.brand")}
            className={cn(
              "flex min-w-0 translate-y-0.5 items-center gap-2 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showCollapsedSidebar ? "size-8 justify-center" : "shrink-0",
            )}
          >
            <AgentNativeIcon
              aria-hidden="true"
              className="h-3.5 w-6 shrink-0 text-foreground"
            />
            {!showCollapsedSidebar && (
              <span className="truncate text-sm font-semibold text-foreground">
                {t("navigation.brand")}
              </span>
            )}
          </NavLink>
          <EnvironmentBadge placement="inline" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {showCollapsedSidebar ? (
            <nav className="flex flex-col items-center gap-1 px-2 py-3">
              {primaryNavItems.map(renderCollapsedNavItem)}
              <div className="mt-2 flex flex-col items-center gap-1 border-t border-border/70 pt-2">
                {lifecycleNavItems.map(renderCollapsedNavItem)}
              </div>
            </nav>
          ) : (
            <nav className="space-y-0.5 px-2 py-3">
              {primaryNavItems.map((item) => (
                <Fragment key={item.to}>
                  {renderExpandedNavItem(item)}
                  {item.to === "/library" && libFolderList.length > 0 && (
                    <div className="ms-4 border-s border-border/70 ps-1">
                      <FolderTree
                        folders={libFolderList}
                        organizationId={currentOrganizationId}
                        spaceId={null}
                        buildPath={(id) => `/library/folder/${id}`}
                        activeFolderId={folderId ?? null}
                      />
                    </div>
                  )}
                  {item.to === "/spaces" &&
                    (spaces?.spaces ?? []).length > 0 && (
                      <ul className="ms-4 space-y-0.5 border-s border-border/70 ps-1">
                        {(spaces?.spaces ?? []).map((s: any) => {
                          const active = spaceId === s.id;
                          return (
                            <li key={s.id}>
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <div
                                    className={cn(
                                      "group flex items-center gap-2 rounded px-2 py-1 text-xs",
                                      active
                                        ? "bg-primary/10 text-primary"
                                        : "text-foreground hover:bg-accent/60",
                                    )}
                                  >
                                    <NavLink
                                      to={`/spaces/${s.id}`}
                                      className="flex min-w-0 flex-1 items-center gap-2"
                                    >
                                      <div
                                        className="flex size-4 shrink-0 items-center justify-center rounded text-[10px]"
                                        style={{
                                          background:
                                            s.color ?? "hsl(var(--primary))",
                                          color:
                                            "hsl(var(--primary-foreground))",
                                        }}
                                      >
                                        {s.iconEmoji ??
                                          s.name.slice(0, 1).toUpperCase()}
                                      </div>
                                      <span className="truncate">{s.name}</span>
                                    </NavLink>
                                    {canManageOrg && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label={`${s.name}: ${t("root.commandActions")}`}
                                            title={`${s.name}: ${t("root.commandActions")}`}
                                            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                                          >
                                            <IconDots className="size-3.5" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="start"
                                          side="right"
                                        >
                                          <DropdownMenuItem
                                            onSelect={() => {
                                              setTimeout(() => {
                                                setRenameSpaceValue(s.name);
                                                setRenameSpaceId(s.id);
                                              }, 0);
                                            }}
                                          >
                                            <IconEdit className="me-2 size-3.5" />
                                            {t("spaceDialog.renameSpace")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onSelect={() => {
                                              setTimeout(() => {
                                                setDeleteSpaceId(s.id);
                                                setDeleteSpaceName(s.name);
                                              }, 0);
                                            }}
                                            className="text-destructive"
                                          >
                                            <IconTrash className="me-2 size-3.5" />
                                            {t("spaceDialog.deleteSpace")}
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuItem asChild>
                                    <NavLink to={`/spaces/${s.id}`}>
                                      <IconUsersGroup className="me-2 size-3.5" />
                                      {t("clipsFinalRaw.view")}
                                    </NavLink>
                                  </ContextMenuItem>
                                  {canManageOrg && (
                                    <>
                                      <ContextMenuSeparator />
                                      <ContextMenuItem
                                        onSelect={() => {
                                          setTimeout(() => {
                                            setRenameSpaceValue(s.name);
                                            setRenameSpaceId(s.id);
                                          }, 0);
                                        }}
                                      >
                                        <IconEdit className="me-2 size-3.5" />
                                        {t("spaceDialog.renameSpace")}
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onSelect={() => {
                                          setTimeout(() => {
                                            setDeleteSpaceId(s.id);
                                            setDeleteSpaceName(s.name);
                                          }, 0);
                                        }}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <IconTrash className="me-2 size-3.5" />
                                        {t("spaceDialog.deleteSpace")}
                                      </ContextMenuItem>
                                    </>
                                  )}
                                </ContextMenuContent>
                              </ContextMenu>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                </Fragment>
              ))}

              <div className="mt-3 space-y-0.5 border-t border-border/70 pt-3">
                {lifecycleNavItems.map(renderExpandedNavItem)}
              </div>
            </nav>
          )}
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-border p-2 empty:hidden",
            showCollapsedSidebar
              ? "flex flex-col items-center gap-1"
              : "flex items-center gap-0.5",
          )}
        >
          <OrgSwitcher
            compact={showCollapsedSidebar}
            className={cn(
              "bg-transparent hover:bg-accent/60",
              !showCollapsedSidebar && "min-w-0 flex-1",
            )}
            settingsPath="/settings/organization"
            currentAppId="clips"
            utilityLinks={workspaceUtilityLinks}
          />
          {collapseButton}
        </div>
      </aside>

      <div className="agent-layout-main-surface flex min-h-0 min-w-0 flex-1 flex-col">
        {!pageOwnsToolbar && (
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
            <button
              type="button"
              aria-label={t("navigation.expandSidebar")}
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground md:hidden"
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
            <div
              ref={setHeaderSlot}
              className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
            />
            <div className="ms-1 flex items-center border-s border-border ps-2">
              <ClipsAgentToggleButton />
            </div>
          </header>
        )}
        <div className="flex min-h-0 flex-1 overflow-hidden [&>.agent-sidebar-shell]:h-full [&>.agent-sidebar-shell]:min-h-0">
          <AgentSidebar
            position="right"
            defaultOpen={false}
            showCollapseButton={isMobile}
            emptyStateText={t("navigation.agentEmptyState")}
            suggestions={[
              t("navigation.agentSuggestionSummary"),
              t("navigation.agentSuggestionPricing"),
              t("navigation.agentSuggestionFiller"),
            ]}
            agentPageHref="/settings/agent"
            scope={recordingScope}
            browserTabId={getBrowserTabId()}
          >
            {/* Main content area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <InvitationBanner />
              <main className="agent-native-app-main flex min-h-0 flex-1 flex-col overflow-y-auto">
                <PageHeaderSlotProvider slot={headerSlot}>
                  {children}
                </PageHeaderSlotProvider>
              </main>
            </div>
          </AgentSidebar>
        </div>
      </div>

      <SpaceDialogs
        renameSpaceId={renameSpaceId}
        renameSpaceName=""
        setRenameSpaceId={setRenameSpaceId}
        renameValue={renameSpaceValue}
        setRenameValue={setRenameSpaceValue}
        deleteSpaceId={deleteSpaceId}
        deleteSpaceName={deleteSpaceName}
        setDeleteSpaceId={setDeleteSpaceId}
        onMutationSuccess={(deletedSpaceId) => {
          if (deletedSpaceId && spaceId === deletedSpaceId) {
            void navigate("/spaces");
          }
          void refetchSpaces?.();
        }}
      />
    </div>
  );
}
