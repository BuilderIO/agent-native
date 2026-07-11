import {
  AgentSidebar,
  AgentToggleButton,
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  getBrowserTabId,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import {
  InvitationBanner,
  OrgSwitcher,
  useOrg,
} from "@agent-native/core/client/org";
import {
  IconInbox,
  IconArchive,
  IconCalendar,
  IconMicrophone2,
  IconTrash,
  IconUsersGroup,
  IconFolderPlus,
  IconPlayerRecord,
  IconAppWindow,
  IconX,
  IconMenu2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconShare,
  IconSettings,
} from "@tabler/icons-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useParams } from "react-router";
import { toast } from "sonner";

import {
  CaptureInstallButton,
  CaptureInstallInlineLink,
} from "@/components/capture-install-options";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
  useCreateFolder,
  useRecordingsCount,
} from "@/hooks/use-library";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefetchVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { cn } from "@/lib/utils";

import { CreateSpaceDialog } from "./create-space-dialog";
import { FolderTree, type FolderNode } from "./folder-tree";
import { PageHeaderSlotProvider } from "./page-header";
import { SearchBar } from "./search-bar";

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
  return <AgentToggleButton />;
}

export function LibraryLayout({ children }: LibraryLayoutProps) {
  const location = useLocation();
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

  const { shouldShowPromo, shouldShowSidebarLink, dismiss } = useDesktopPromo();
  usePrefetchVideoStorageStatus();

  const { data: org } = useOrg();
  const hasActiveOrg = Boolean(org?.orgId);
  const { data: organizations } = useOrganizations({ enabled: hasActiveOrg });
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;

  const { data: spaces } = useSpaces(currentOrganizationId, {
    enabled: hasActiveOrg && Boolean(currentOrganizationId),
  });
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
  const sidebarHasNewRecordingAction = isMobile
    ? sidebarOpen
    : !sidebarCollapsed;

  // Routes whose page renders its own h-12 toolbar. Layout still mounts Sidebar
  // + AgentSidebar, but skips its own header so there's no double-header.
  const pageOwnsToolbar =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  const pageHasHeaderSearch =
    location.pathname.startsWith("/library") ||
    location.pathname === "/shared" ||
    location.pathname === "/archive" ||
    /^\/spaces\/[^/]+/.test(location.pathname);

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
      // Ignore browsers that block localStorage; the toggle still works.
    }
  }, [sidebarCollapsed]);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const createFolder = useCreateFolder();

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
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      match: (p) => p.startsWith("/settings"),
    },
  ];

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
            "flex h-12 shrink-0 items-center border-b border-border",
            showCollapsedSidebar ? "justify-center px-2" : "px-4",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              !showCollapsedSidebar && "flex-1",
            )}
          >
            {!showCollapsedSidebar && (
              <>
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
                <span className="truncate text-sm font-semibold text-foreground">
                  {t("navigation.brand")}
                </span>
              </>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground md:inline-flex"
                aria-label={
                  showCollapsedSidebar
                    ? t("navigation.expandSidebar")
                    : t("navigation.collapseSidebar")
                }
                aria-expanded={!showCollapsedSidebar}
                onClick={() => setSidebarCollapsed((value) => !value)}
              >
                {showCollapsedSidebar ? (
                  <IconLayoutSidebarLeftExpand className="h-4 w-4" />
                ) : (
                  <IconLayoutSidebarLeftCollapse className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {showCollapsedSidebar
                ? t("navigation.expandSidebar")
                : t("navigation.collapseSidebar")}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {showCollapsedSidebar ? (
            <>
              <div className="flex justify-center px-2 py-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to="/record"
                      aria-label={t("navigation.newRecording")}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      <IconPlayerRecord className="h-4 w-4" />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("navigation.newRecording")}
                  </TooltipContent>
                </Tooltip>
              </div>

              <nav className="mt-3 flex flex-col items-center gap-1 px-2">
                {navItems.map(({ to, label, icon: Icon, match }) => {
                  const active = match(location.pathname);
                  return (
                    <Tooltip key={to}>
                      <TooltipTrigger asChild>
                        <NavLink
                          to={to}
                          aria-label={label}
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                            active &&
                              "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </nav>
            </>
          ) : (
            <>
              <div className="px-3 py-3">
                <Button
                  className="w-full gap-1.5"
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <NavLink to="/record">
                    <IconPlayerRecord className="h-4 w-4" />
                    {t("navigation.newRecording")}
                  </NavLink>
                </Button>
              </div>

              <nav className="mt-3 space-y-0.5 px-2">
                {navItems.map(({ to, label, icon: Icon, match, count }) => {
                  const active = match(location.pathname);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-accent/60",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 truncate">{label}</span>
                      {count !== undefined && count > 0 && (
                        <span
                          className={cn(
                            "shrink-0 tabular-nums text-[11px]",
                            active
                              ? "text-primary/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>

              <div className="mt-4 space-y-4 px-2 pb-3">
                <div>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("navigation.folders")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("navigation.newFolder")}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          onClick={() => setNewFolderOpen(true)}
                        >
                          <IconFolderPlus className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("navigation.newFolder")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <FolderTree
                    folders={libFolderList}
                    organizationId={currentOrganizationId}
                    spaceId={null}
                    buildPath={(id) => `/library/folder/${id}`}
                    activeFolderId={folderId ?? null}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("navigation.spaces")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("navigation.spaces")}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          onClick={() => setNewSpaceOpen(true)}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("navigation.spaces")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <ul className="space-y-0.5">
                    {(spaces?.spaces ?? []).map((s: any) => {
                      const active = spaceId === s.id;
                      return (
                        <li key={s.id}>
                          <NavLink
                            to={`/spaces/${s.id}`}
                            className={cn(
                              "flex items-center gap-2 rounded px-2 py-1 text-xs",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-accent/60",
                            )}
                          >
                            <div
                              className="flex h-4 w-4 items-center justify-center rounded text-[10px]"
                              style={{
                                background: s.color ?? "hsl(var(--primary))",
                                color: "white",
                              }}
                            >
                              {s.iconEmoji ?? s.name.slice(0, 1).toUpperCase()}
                            </div>
                            <span className="truncate">{s.name}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                    {(spaces?.spaces ?? []).length === 0 && (
                      <li className="px-2 py-1 text-[11px] text-muted-foreground/70">
                        {t("navigation.noSpaces")}
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        {!showCollapsedSidebar && (
          <>
            <div className="shrink-0 space-y-1.5 px-2 py-1.5">
              {shouldShowSidebarLink && (
                <CaptureInstallInlineLink className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-accent/60">
                  <IconAppWindow className="h-4 w-4" />
                  {t("navigation.desktopCta")}
                </CaptureInstallInlineLink>
              )}
              {(isMobile || !pageHasHeaderSearch) && <SearchBar />}
            </div>

            <div className="shrink-0 px-1 py-1">
              <ExtensionsSidebarSection />
            </div>

            <div className="shrink-0 space-y-2 px-3 py-2">
              <OrgSwitcher settingsPath="/settings/organization" />
              <DevDatabaseLink />
              <FeedbackButton />
            </div>
          </>
        )}
      </aside>

      <AgentSidebar
        position="right"
        defaultOpen={!isMobile}
        emptyStateText={t("navigation.agentEmptyState")}
        suggestions={[
          t("navigation.agentSuggestionSummary"),
          t("navigation.agentSuggestionPricing"),
          t("navigation.agentSuggestionFiller"),
        ]}
        scope={recordingScope}
        browserTabId={getBrowserTabId()}
      >
        {/* Main content area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!pageOwnsToolbar && (
            <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground md:hidden"
              >
                <IconMenu2 className="h-4 w-4" />
              </button>
              <div
                ref={setHeaderSlot}
                className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
              />
              <div className="ms-auto flex items-center gap-2">
                <ClipsAgentToggleButton />
              </div>
            </header>
          )}
          <InvitationBanner />
          {shouldShowPromo && (
            <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-5 py-2.5 text-sm">
              <IconAppWindow className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">
                  {t("navigation.desktopTitle")}
                </span>{" "}
                <span className="text-muted-foreground">
                  {t("navigation.desktopBody")}
                </span>
              </div>
              <CaptureInstallButton
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                Download
              </CaptureInstallButton>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={dismiss}
                  >
                    <IconX className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("clipsFinalRaw.alreadyHaveIt")}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          <main className="agent-native-app-main flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PageHeaderSlotProvider
              slot={headerSlot}
              sidebarHasNewRecordingAction={sidebarHasNewRecordingAction}
            >
              {children}
            </PageHeaderSlotProvider>
          </main>
        </div>
      </AgentSidebar>

      {/* New folder dialog (library root) */}
      <AlertDialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("navigation.newFolder")}</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("navigation.folderNamePlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = newFolderName.trim();
                if (!name) return;
                createFolder.mutate(
                  {
                    name,
                    ...(currentOrganizationId
                      ? { organizationId: currentOrganizationId }
                      : {}),
                    parentId: null,
                  },
                  {
                    onSuccess: () =>
                      toast.success(t("navigation.folderCreated")),
                    onError: (err: any) =>
                      toast.error(
                        err?.message ?? t("navigation.createFolderError"),
                      ),
                  },
                );
                setNewFolderName("");
                setNewFolderOpen(false);
              }}
            >
              {t("common.create")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateSpaceDialog
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        organizationId={currentOrganizationId}
      />
    </div>
  );
}
