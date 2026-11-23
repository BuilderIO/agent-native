import { useT } from "@agent-native/core/client/i18n";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArchive,
  IconChecklist,
  IconDatabase,
  IconFileText,
  IconFolder,
  IconHome,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconMenu2,
  IconMessageCircle,
  IconMessages,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { hasRoutePage } from "@/components/workspace/pages";
import { useWorkspaceData } from "@/components/workspace/WorkspaceDataContext";
import messages from "@/i18n/en-US";

import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import { AccountMenu } from "./AccountMenu";
import { MoreMenu } from "./MoreMenu";
import { NotificationsMenu } from "./NotificationsMenu";
import { NavRow, SidebarSection, type SectionRow } from "./primitives";
import { QuickCreate } from "./QuickCreate";
import { secondaryFeaturesEnabled } from "./secondary-features";
import type {
  WorkspaceShellProps,
  WorkspaceShellRow,
  WorkspaceShellRowKind,
} from "./types";
import { WorkspaceMenu } from "./WorkspaceMenu";

export type {
  WorkspaceShellAccountMenu,
  WorkspaceShellFeatures,
  WorkspaceShellHandler,
  WorkspaceShellNotification,
  WorkspaceShellNotifications,
  WorkspaceShellProps,
  WorkspaceShellQuickCreate,
  WorkspaceShellRow,
  WorkspaceShellRowKind,
  WorkspaceShellUser,
  WorkspaceShellWorkspace,
  WorkspaceShellWorkspaceEntry,
  WorkspaceShellWorkspaceMenu,
} from "./types";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

function rowIcon(kind: WorkspaceShellRowKind) {
  switch (kind) {
    case "thread":
      return <IconMessageCircle size={16} />;
    case "collection":
      return <IconFolder size={16} />;
    case "data":
      return <IconDatabase size={16} />;
    case "project":
    default:
      return <IconFileText size={16} />;
  }
}

const RECENTS_COLLAPSED_COUNT = 5;

function toSectionRows(rows: WorkspaceShellRow[]): SectionRow[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    href: row.href,
    icon: rowIcon(row.kind),
  }));
}

const FAVORITE_SECTIONS: Array<{
  kind: WorkspaceShellRowKind;
  title: string;
}> = [
  { kind: "project", title: "Favorite projects" },
  { kind: "collection", title: "Favorite collections" },
  { kind: "data", title: "Favorite data" },
];

export function WorkspaceShell({
  children,
  workspace,
  user,
  features,
  capabilities,
  recents,
  favorites,
  detailsStatus = "ready",
  onCreateProject,
  onCreateThread,
  onOpenSearch,
  workspaceMenu,
  accountMenu,
  quickCreate,
  notifications,
}: WorkspaceShellProps) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceData = useWorkspaceData();
  const pathname = location.pathname;
  const mediumOrSmaller = useMediaQuery("(max-width: 1050px)");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    setSidebarOpen(!mediumOrSmaller);
  }, [mediumOrSmaller]);

  useEffect(() => {
    if (mediumOrSmaller) setSidebarOpen(false);
  }, [mediumOrSmaller, pathname]);

  const closeOnNavigate = useCallback(() => {
    if (mediumOrSmaller) setSidebarOpen(false);
  }, [mediumOrSmaller]);

  const isHome = pathname === "/home" || pathname === "/";
  const isData =
    pathname === "/home/data" || pathname.startsWith("/home/data/");
  const isFolders =
    pathname === "/home/folders" || pathname.startsWith("/home/folders/");
  const isDrafts =
    pathname === "/home/drafts" || pathname.startsWith("/home/drafts/");
  const isProjects =
    pathname === "/home/all" || pathname.startsWith("/home/all/");
  const isCollections =
    pathname === "/home/collections" ||
    pathname.startsWith("/home/collections/");
  const isThreads =
    pathname === "/home/threads" || pathname.startsWith("/home/threads/");
  const isTasks =
    pathname === "/home/tasks" || pathname.startsWith("/home/tasks/");
  const isArchive =
    pathname === "/home/archive" || pathname.startsWith("/home/archive/");
  const isTrash =
    pathname === "/home/trash" || pathname.startsWith("/home/trash/");

  const favoriteSections = FAVORITE_SECTIONS.map((section) => ({
    ...section,
    rows: toSectionRows(
      favorites.filter((favorite) => favorite.kind === section.kind),
    ),
  })).filter((section) => section.rows.length > 0);

  return (
    <div className="ws-root">
      <div className="ws-mobile-nav">
        <div className="ws-mobile-nav-left">
          <button
            type="button"
            className="ws-icon-button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <IconMenu2 size={16} aria-hidden="true" />
          </button>
          <WorkspaceMenu
            workspace={workspace}
            workspaceMenu={workspaceMenu}
            onNavigate={closeOnNavigate}
          />
        </div>
        <div className="ws-mobile-nav-right">
          <button
            type="button"
            className="ws-icon-button"
            aria-label="Search"
            title="Search"
            data-search-trigger="true"
            onClick={() => {
              void onOpenSearch();
            }}
          >
            <IconSearch size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="ws-body">
        <div className="ws-main">
          <aside
            className="ws-sidebar"
            aria-label="Workspace"
            data-closed={!sidebarOpen}
          >
            <div className="ws-sidebar-inner">
              <div className="ws-sidebar-header">
                <div className="ws-workspace-slot">
                  <WorkspaceMenu
                    workspace={workspace}
                    workspaceMenu={workspaceMenu}
                    onNavigate={closeOnNavigate}
                  />
                </div>
                <div className="ws-header-actions">
                  <NotificationsMenu notifications={notifications} />
                  {mediumOrSmaller ? (
                    <button
                      type="button"
                      className="ws-icon-button"
                      aria-label="Close navigation"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <IconX size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              <QuickCreate
                features={features}
                quickCreate={quickCreate}
                onCreateProject={onCreateProject}
                onCreateThread={
                  workspaceData
                    ? () => {
                        void navigate("/thread");
                      }
                    : onCreateThread
                }
              />
              <div className="ws-search-slot">
                <button
                  type="button"
                  className="ws-search-button"
                  data-search-trigger="true"
                  onClick={() => {
                    void onOpenSearch();
                  }}
                >
                  <IconSearch size={16} aria-hidden="true" />
                  <span className="ws-search-label">Search</span>
                  <span className="ws-keycap" aria-hidden="true">
                    ⌘ K
                  </span>
                </button>
              </div>
              <div className="ws-tabs">
                <NavRow
                  to="/home"
                  label="Home"
                  icon={<IconHome size={16} aria-hidden="true" />}
                  active={isHome}
                  onNavigate={closeOnNavigate}
                />
                {capabilityAllowed(
                  capabilities,
                  ANALYTICS_CONTROL_IDS.dataBrowse,
                ) ? (
                  <NavRow
                    to="/home/data"
                    label={t("analytics.shell.data", {
                      defaultValue: messages.analytics.shell.data,
                    })}
                    icon={<IconDatabase size={16} aria-hidden="true" />}
                    active={isData}
                    onNavigate={closeOnNavigate}
                  />
                ) : null}
              </div>
              <div className="ws-scroll">
                <div className="ws-tabs-scroll">
                  {features.folders ? (
                    <>
                      <NavRow
                        to="/home/folders"
                        label="Folders"
                        icon={<IconFolder size={16} aria-hidden="true" />}
                        active={isFolders}
                        onNavigate={closeOnNavigate}
                      />
                      <NavRow
                        to="/home/drafts"
                        label="Drafts"
                        icon={<IconFileText size={16} aria-hidden="true" />}
                        active={isDrafts}
                        onNavigate={closeOnNavigate}
                      />
                    </>
                  ) : null}
                  <NavRow
                    to="/home/all"
                    label="Projects"
                    icon={<IconLayoutDashboard size={16} aria-hidden="true" />}
                    active={isProjects}
                    onNavigate={closeOnNavigate}
                  />
                  <NavRow
                    to="/home/collections"
                    label="Collections"
                    icon={<IconLayoutGrid size={16} aria-hidden="true" />}
                    active={isCollections}
                    onNavigate={closeOnNavigate}
                  />
                  {features.threads ? (
                    <NavRow
                      to="/home/threads"
                      label="Threads"
                      icon={<IconMessages size={16} aria-hidden="true" />}
                      active={isThreads}
                      onNavigate={closeOnNavigate}
                    />
                  ) : null}
                  {secondaryFeaturesEnabled() &&
                  features.tasks &&
                  hasRoutePage("home", "tasks") ? (
                    <NavRow
                      to="/home/tasks"
                      label="Tasks"
                      icon={<IconChecklist size={16} aria-hidden="true" />}
                      active={isTasks}
                      onNavigate={closeOnNavigate}
                    />
                  ) : null}
                  <MoreMenu features={features} onNavigate={closeOnNavigate} />
                  <div className="ws-spacer" />
                  <div className="ws-sections">
                    {detailsStatus === "ready" ? (
                      <>
                        <SidebarSection
                          title="RECENTS"
                          rows={toSectionRows(recents)}
                          collapsedCount={RECENTS_COLLAPSED_COUNT}
                          onNavigate={closeOnNavigate}
                        />
                        {favoriteSections.map((section) => (
                          <SidebarSection
                            key={section.kind}
                            title={section.title}
                            rows={section.rows}
                            onNavigate={closeOnNavigate}
                          />
                        ))}
                      </>
                    ) : detailsStatus === "loading" ? (
                      <div aria-busy="true">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="mt-3 h-8 w-full" />
                        <Skeleton className="mt-2 h-8 w-full" />
                      </div>
                    ) : null}
                  </div>
                  <div className="ws-spacer" />
                  <NavRow
                    to="/home/archive"
                    label="Archive"
                    icon={<IconArchive size={16} aria-hidden="true" />}
                    active={isArchive}
                    onNavigate={closeOnNavigate}
                  />
                  <NavRow
                    to="/home/trash"
                    label="Trash"
                    icon={<IconTrash size={16} aria-hidden="true" />}
                    active={isTrash}
                    onNavigate={closeOnNavigate}
                  />
                </div>
              </div>
              <div className="ws-footer">
                <div className="ws-footer-surface">
                  <div className="ws-footer-row">
                    <AccountMenu user={user} accountMenu={accountMenu} />
                    <Link
                      to="/settings"
                      className="ws-icon-button"
                      aria-label="Settings"
                      title="Go to settings"
                      onClick={closeOnNavigate}
                    >
                      <IconSettings size={16} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </aside>
          {mediumOrSmaller && sidebarOpen ? (
            <button
              type="button"
              className="ws-overlay"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
          <main className="ws-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
