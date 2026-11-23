import {
  compareAndSetClientAppState,
  readClientAppState,
} from "@agent-native/core/client/application-state";
import {
  callAction,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  HomePage,
  type HomeFavorites,
  type HomeRecentRow,
  type HomeRecents,
} from "@/components/home";
import { HomeGetStartedGrid } from "@/components/home/get-started";
import { TAB_ID } from "@/lib/tab-id";

import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import { lazyRoute } from "./lazy-route";
import { loadHomeComposer } from "./route-critical-code";
import type { RoutePageProps } from "./types";
import { useWorkspaceData } from "./WorkspaceDataContext";

const WorkspaceAgent = lazyRoute(loadHomeComposer);

function rowsOf(
  rows: readonly { id: string; title: string; href: string; kind: string }[],
  kind: HomeRecentRow["kind"],
): HomeRecentRow[] {
  return rows
    .filter((row) => row.kind === kind)
    .map((row) => ({ id: row.id, title: row.title, href: row.href, kind }));
}

/** Formats recent-item timestamps. */
function relativeTime(iso: string, now = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const label = (value: number, one: string, many: string) =>
    value <= 1 ? one : many.replace("%d", String(value));
  if (seconds < 60) return `${label(seconds, "1 sec", "%d secs")} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${label(minutes, "1 min", "%d mins")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${label(hours, "1 hr", "%d hrs")} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${label(days, "1 day", "%d days")} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${label(weeks, "1 week", "%d weeks")} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${label(months, "1 month", "%d months")} ago`;
  return `${label(Math.floor(days / 365), "1 year", "%d years")} ago`;
}

/** Home body populated from workspace reads and available capabilities. */
export function HomePageView(_props: RoutePageProps) {
  const t = useT();
  const value = useWorkspaceData();
  const identity = value?.shell;
  const snoozeKey = `context-setup-snoozed:${TAB_ID}:${identity?.workspace.id ?? ""}`;
  const [snooze, setSnooze] = useState<{ key: string; value: boolean } | null>(
    null,
  );
  const snoozeRevision = useRef(0);
  useEffect(() => {
    let active = true;
    const revision = snoozeRevision.current;
    void readClientAppState<{ snoozed: boolean }>(snoozeKey)
      .then((state) => {
        if (active && revision === snoozeRevision.current)
          setSnooze({ key: snoozeKey, value: state?.snoozed === true });
      })
      .catch(() => {
        if (active) toast.error(t("analytics.home.snoozeFailed"));
      });
    return () => {
      active = false;
    };
  }, [snoozeKey, t]);
  const getStartedKey = `get-started-dismissed:${identity?.workspace.id ?? ""}`;
  const [getStartedDismissed, setGetStartedDismissed] = useState<{
    key: string;
    value: boolean;
  } | null>(null);
  const getStartedRevision = useRef(0);
  const [getStartedSaving, setGetStartedSaving] = useState(false);
  useEffect(() => {
    let active = true;
    const revision = getStartedRevision.current;
    void readClientAppState<{ dismissed: boolean }>(getStartedKey)
      .then((state) => {
        if (active && revision === getStartedRevision.current)
          setGetStartedDismissed({
            key: getStartedKey,
            value: state?.dismissed === true,
          });
      })
      .catch(() => {
        if (!active) return;
        if (revision === getStartedRevision.current)
          setGetStartedDismissed({ key: getStartedKey, value: false });
        toast.error(t("analytics.home.snoozeFailed"));
      });
    return () => {
      active = false;
    };
  }, [getStartedKey, t]);
  const saveChecklistDismissed = (dismissed: boolean) => {
    if (getStartedSaving) return;
    const previous = getStartedDismissed;
    const revision = ++getStartedRevision.current;
    setGetStartedSaving(true);
    setGetStartedDismissed({ key: getStartedKey, value: dismissed });
    void writeClientAppState(
      getStartedKey,
      { dismissed },
      { requestSource: TAB_ID },
    )
      .catch(() => {
        if (revision === getStartedRevision.current) {
          setGetStartedDismissed(previous);
          toast.error(t("analytics.home.setupUpdateFailed"));
        }
      })
      .finally(() => {
        if (revision === getStartedRevision.current) setGetStartedSaving(false);
      });
  };
  const [homeIntent, setHomeIntent] = useState<"notebook" | "app" | null>(null);
  const [homeMountId] = useState(() => crypto.randomUUID());
  const stateWrite = useRef(Promise.resolve());
  useEffect(() => {
    const state = { intent: homeIntent, mountId: homeMountId };
    stateWrite.current = stateWrite.current
      .then(() =>
        writeClientAppState(`home-composer:${TAB_ID}`, state, {
          requestSource: TAB_ID,
        }),
      )
      .then(() => undefined)
      .catch((error) => {
        console.error("Could not update home composer state", error);
      });
    return () => {
      stateWrite.current = stateWrite.current
        .then(() =>
          compareAndSetClientAppState(`home-composer:${TAB_ID}`, state, null, {
            requestSource: TAB_ID,
          }),
        )
        .then(() => undefined)
        .catch((error) => {
          console.error("Could not clear home composer state", error);
        });
    };
  }, [homeIntent, homeMountId]);
  const popularQuery = useActionQuery<{
    projects: Array<{
      id: string;
      title: string;
      allowEmbedding: boolean;
      viewCount: number;
      ownerName: string | null;
      creatorName: string | null;
      createdAt: string;
      lastEditedAt: string;
      namesUnavailable: boolean;
    }>;
  }>("list-popular-projects", {
    limit: 6,
    viewCountDuration: "oneWeek",
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const changeProjectLifecycle = async (
    action: "archive-project" | "trash-project",
    projectId: string,
  ) => {
    await callAction(action, { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };
  if (!value) return null;
  const {
    shell: workspace,
    activity,
    activityStatus: status,
    contextSetup,
    contextSetupPending,
  } = value;
  const canAddConnection = capabilityAllowed(
    workspace.capabilities,
    ANALYTICS_CONTROL_IDS.bigQueryConnectionCreate,
  );
  const canBrowseData = capabilityAllowed(
    workspace.capabilities,
    ANALYTICS_CONTROL_IDS.dataBrowse,
  );
  const canGenerateApp = capabilityAllowed(
    workspace.capabilities,
    ANALYTICS_CONTROL_IDS.generateApp,
  );
  const onCreateProject = capabilityAllowed(
    workspace.capabilities,
    ANALYTICS_CONTROL_IDS.createProject,
  )
    ? value.onCreateProject
    : undefined;

  const recents: HomeRecents = {
    projects: {
      kind: "project",
      enabled: true,
      status,
      rows: (activity?.homeRecents.projects ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        href: row.href,
        kind: "project" as const,
        favorited: row.favorited,
        ...(row.notebookHref ? { notebookHref: row.notebookHref } : {}),
        canEdit: row.canEdit,
        ownerLabel: row.ownerLabel,
        metaLabel: relativeTime(row.lastViewedAt ?? row.updatedAt),
      })),
      viewAllHref: "/home/all?sort=recentlyViewed",
    },
    threads: {
      kind: "thread",
      enabled: workspace.features.threads,
      status,
      rows: (activity?.homeRecents.threads ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        href: row.href,
        kind: "thread" as const,
        ownerLabel: row.ownerLabel,
        metaLabel: relativeTime(row.updatedAt),
      })),
      viewAllHref: "/home/threads",
    },
    explorations: {
      kind: "exploration",
      enabled: workspace.features.canExplore,
      status: "ready",
      rows: [],
    },
    data: {
      kind: "data",
      enabled: canBrowseData,
      status,
      rows: rowsOf(activity?.recents ?? [], "data"),
      viewAllHref: "/home/data",
    },
  };

  const favorites: HomeFavorites = {
    collectionsEnabled: true,
    status,
    projects: (activity?.favorites ?? [])
      .filter((row) => row.kind === "project")
      .map((row) => ({ id: row.id, title: row.title, href: row.href })),
    collections: (activity?.favorites ?? [])
      .filter((row) => row.kind === "collection")
      .map((row) => ({ id: row.id, title: row.title, href: row.href })),
  };

  return (
    <HomePage
      user={workspace.user}
      workspace={workspace.workspace}
      contextProgressPending={contextSetupPending}
      contextProgress={
        contextSetup
          ? {
              enabled: snooze?.key !== snoozeKey || !snooze.value,
              ...contextSetup,
              canDismiss: false,
            }
          : null
      }
      recents={recents}
      suggestions={{ status: "unavailable", issues: [] }}
      favorites={favorites}
      popular={
        popularQuery.isError
          ? {
              status: "error" as const,
              projects: [],
              onRetry: () => void popularQuery.refetch(),
            }
          : popularQuery.data
            ? {
                status: "ready" as const,
                viewAllHref: "/home/all?sort=popular",
                projects: popularQuery.data.projects.map((row) => ({
                  id: row.id,
                  title:
                    row.title.trim() || t("analytics.lists.untitledProject"),
                  href: `/app/${encodeURIComponent(row.id)}/latest`,
                  allowEmbedding: row.allowEmbedding,
                  viewCountLabel: String(row.viewCount),
                  viewCountTooltip: t("analytics.home.popularViewCount", {
                    count: row.viewCount,
                  }),
                  information: {
                    ownerName: row.ownerName,
                    creatorName: row.creatorName,
                    createdAt: row.createdAt,
                    lastEditedAt: row.lastEditedAt,
                    namesUnavailable: row.namesUnavailable,
                  },
                })),
              }
            : { status: "loading" as const, projects: [] }
      }
      agentComposer={
        <WorkspaceAgent
          mode="home"
          orgId={workspace.workspace.id}
          homeIntent={homeIntent}
          onClearHomeIntent={() => setHomeIntent(null)}
        />
      }
      activeIntent={homeIntent}
      getStarted={
        canAddConnection || onCreateProject ? (
          <HomeGetStartedGrid
            checklistDismissed={
              getStartedDismissed?.key === getStartedKey
                ? getStartedDismissed.value
                : true
            }
            canAddConnection={canAddConnection}
            onCreateProject={onCreateProject}
            onCreateThread={
              workspace.features.canCreateThread
                ? () => {
                    void navigate("/thread");
                  }
                : undefined
            }
            onImportProject={value.onImportProject}
            onAskAgent={() => {
              const composer = document.querySelector<HTMLElement>(
                ".ws-home-composer [contenteditable='true'], .ws-home-composer textarea, .ws-home-composer input",
              );
              composer?.scrollIntoView?.({ block: "center" });
              composer?.focus();
            }}
            completedSteps={[
              ...(activity?.hasDataConnection || recents.data.rows.length > 0
                ? (["connect"] as const)
                : []),
              ...(recents.projects.rows.length > 0
                ? (["project"] as const)
                : []),
              ...(recents.threads.rows.length > 0 ? (["ask"] as const) : []),
            ]}
            saving={getStartedSaving}
            onDismiss={() => saveChecklistDismissed(true)}
            {...(getStartedDismissed?.key === getStartedKey
              ? { onRestore: () => saveChecklistDismissed(false) }
              : {})}
          />
        ) : null
      }
      callbacks={{
        canGenerateApp,
        canAnalyzeInNotebook: onCreateProject !== undefined,
        onToggleFavoriteProject: async (projectId, favorited) => {
          await callAction("favorite-project", { projectId, favorited });
          await queryClient.invalidateQueries({ queryKey: ["action"] });
        },
        onArchiveProject: (id: string) =>
          changeProjectLifecycle("archive-project", id),
        onTrashProject: (id: string) =>
          changeProjectLifecycle("trash-project", id),
        onOpenContextStudio: () => void navigate("/context-studio"),
        onSelectContextStep: (step) =>
          void navigate(`/context-studio/setup#context-setup-${step}`),
        onDismissContextBanner: () => {
          snoozeRevision.current += 1;
          setSnooze({ key: snoozeKey, value: true });
          void writeClientAppState(
            snoozeKey,
            { snoozed: true },
            { requestSource: TAB_ID },
          ).catch(() => {
            setSnooze((current) =>
              current?.key === snoozeKey
                ? { key: snoozeKey, value: false }
                : current,
            );
            toast.error(t("analytics.home.snoozeFailed"));
          });
        },
        onBrowseProjects: () => void navigate("/home/all"),
        onBrowseCollections: () => void navigate("/home/collections"),
        onBrowseData: () => void navigate("/home/data"),
        onSelectIntent: (intent) => {
          if (intent === "notebook" && !onCreateProject) return;
          if (intent === "app" && !canGenerateApp) return;
          setHomeIntent(intent);
          document
            .querySelector<HTMLElement>(
              ".ws-home-composer [contenteditable='true'], .ws-home-composer textarea, .ws-home-composer input",
            )
            ?.focus();
        },
        ...(onCreateProject ? { onCreateProject } : {}),
        ...(workspace.features.canCreateThread
          ? {
              onCreateThread: () => {
                void navigate("/thread");
              },
            }
          : {}),
      }}
    />
  );
}
