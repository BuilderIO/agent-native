import {
  actionErrorMessage,
  callAction,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useResources,
  useUpdateResource,
} from "@agent-native/core/client/resources/use-resources";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  getSkillNameFromPath,
  restorePathForTrashedSkill,
  SKILL_TRASH_PREFIX,
} from "@agent-native/core/resources/metadata";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoutePageProps } from "@/components/workspace/types";
import { useWorkspaceData } from "@/components/workspace/WorkspaceDataContext";
import { resourcePath } from "@/lib/navigation-contract";

import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import {
  clampSearchText,
  PROJECT_LIST_SEARCH_MAX_LENGTH,
} from "../../../shared/search-limits";
import { PopularProjectsPage } from "./PopularProjectsPage";
import {
  parseProjectsSortParam,
  ProjectsListView,
  type ProjectCategoryChip,
  type ProjectsListStatus,
} from "./ProjectsListView";

import "./projects.css";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The list view a route renders: the sidebar's Projects link is the active list,
 * and Archive and Trash are the same list over the action's other views (the
 * action already supports all three), so those links stop opening an empty frame.
 */
export function projectsListViewFor(
  view: string | undefined,
): "active" | "archive" | "trash" {
  if (view === "trash") return "trash";
  if (view === "archive" || view === "archived") return "archive";
  return "active";
}

/**
 * Home → Projects (all projects), and the same list for Archive and Trash.
 *
 * The list is the complete workspace project listing from `list-projects`,
 * never the shell's ten-item recents preview. Filters and sort are UI state over
 * that result; search is also sent to the action so the server can narrow it.
 */
export function ProjectsPage({ route }: RoutePageProps) {
  if (route.view === "all" && route.query.get("sort") === "popular") {
    return <PopularProjectsPage />;
  }
  return <OrdinaryProjectsPage route={route} />;
}

/**
 * The Projects list for one route, or, with `collectionId`, the same list
 * narrowed to one collection's projects under that collection's own header.
 */
export function OrdinaryProjectsPage({
  route,
  collectionId,
  onAddToCollection,
}: {
  route?: RoutePageProps["route"];
  collectionId?: string;
  onAddToCollection?: () => void;
}) {
  const t = useT();
  // A collection lists its active projects; Archive and Trash stay on their routes.
  const view =
    collectionId === undefined ? projectsListViewFor(route?.view) : "active";
  const workspace = useWorkspaceData();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDebouncedSearch(
          clampSearchText(search, PROJECT_LIST_SEARCH_MAX_LENGTH),
        ),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);

  const projectsQuery = useActionQuery(
    "list-projects",
    {
      view,
      search: debouncedSearch,
      ...(collectionId === undefined ? {} : { collectionId }),
    },
    {
      retry: 1,
      enabled: workspace !== undefined,
      queryKeyScope: [
        workspace?.shell.user.email,
        workspace?.shell.workspace.id,
      ],
    },
  );

  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialSort = useMemo(
    () => parseProjectsSortParam(searchParams.get("sort")),
    [searchParams],
  );
  const navigate = useNavigate();
  // The source's row menu opens the copy straight after it is created.
  const duplicateProject = async (projectId: string) => {
    try {
      const result = await callAction<{ project: { id: string } }>(
        "duplicate-project",
        { projectId },
      );
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      await navigate(resourcePath("project", result.project.id));
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ??
          t("analytics.lists.duplicateFailed", {
            noun: t("analytics.lists.projectNoun"),
          }),
      );
    }
  };
  const renameProject = async (projectId: string, title: string) => {
    await callAction("update-project", { projectId, title });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };
  const trashProject = async (projectId: string) => {
    await callAction("trash-project", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const statusQuery = useActionQuery("list-data-statuses", {}, { retry: 1 });
  const collectionsQuery = useActionQuery("list-collections", {}, { retry: 1 });
  const projectCollectionsQuery = useActionQuery(
    "list-project-collections",
    {},
    { retry: 1 },
  );
  const collectionsByProject = useMemo(() => {
    const names = new Map<string, string>(
      (collectionsQuery.data?.collections ?? []).map(
        (collection: { id: string; name: string }) =>
          [collection.id, collection.name] as const,
      ),
    );
    const byProject = new Map<
      string,
      readonly { id: string; name: string }[]
    >();
    for (const assignment of projectCollectionsQuery.data?.assignments ?? []) {
      byProject.set(
        assignment.projectId,
        assignment.collectionIds
          .map((collectionId: string) => {
            const name = names.get(collectionId);
            return name === undefined ? undefined : { id: collectionId, name };
          })
          .filter(
            (
              entry: { id: string; name: string } | undefined,
            ): entry is { id: string; name: string } => entry !== undefined,
          ),
      );
    }
    return byProject;
  }, [collectionsQuery.data, projectCollectionsQuery.data]);
  const toggleProjectCollection = async (
    projectId: string,
    collectionId: string,
    add: boolean,
  ) => {
    await callAction(
      add ? "add-project-to-collection" : "remove-project-from-collection",
      { projectId, collectionId },
    );
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const createProjectInCollection = async (targetCollectionId: string) => {
    const created = await callAction("create-project", {
      requestId: crypto.randomUUID(),
    });
    await callAction("add-project-to-collection", {
      projectId: created.projectId,
      collectionId: targetCollectionId,
    });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
    void navigate(created.href);
  };

  const toggleFavorite = async (projectId: string, favorited: boolean) => {
    await callAction("favorite-project", { projectId, favorited });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const archiveProject = async (projectId: string) => {
    await callAction("archive-project", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const unarchiveProject = async (projectId: string) => {
    await callAction("unarchive-project", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const restoreProject = async (projectId: string) => {
    await callAction("restore-project", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const deleteProject = async (projectId: string) => {
    await callAction("delete-project", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const clearOutputs = async (projectId: string) => {
    await callAction("clear-project-outputs", { projectId });
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const categoryQuery = useActionQuery(
    "list-project-categories",
    {},
    { retry: 1 },
  );
  const categoriesByProject = useMemo(() => {
    const catalogue = new Map<string, ProjectCategoryChip>();
    for (const category of categoryQuery.data?.categories ?? []) {
      catalogue.set(category.id, category);
    }
    const byProject = new Map<string, readonly ProjectCategoryChip[]>();
    for (const assignment of categoryQuery.data?.assignments ?? []) {
      byProject.set(
        assignment.projectId,
        assignment.categoryIds
          .map((categoryId) => catalogue.get(categoryId))
          .filter(
            (category): category is ProjectCategoryChip =>
              category !== undefined,
          ),
      );
    }
    return byProject;
  }, [categoryQuery.data]);

  const trashedSkills = useTrashedSkills(
    view === "trash" && workspace !== undefined,
    workspace?.shell.features.isAdmin ?? false,
    JSON.stringify([
      workspace?.shell.user.email,
      workspace?.shell.workspace.id,
    ]),
  );
  const archiveSettingsQuery = useActionQuery(
    "get-organization-archive-settings",
    {},
    {
      retry: 1,
      enabled: workspace !== undefined && view === "archive",
      queryKeyScope: [
        workspace?.shell.user.email,
        workspace?.shell.workspace.id,
      ],
    },
  );

  if (!workspace) return null;

  const { shell, onCreateProject, onImportProject } = workspace;
  const isAdmin = shell.features.isAdmin === true;
  const canCreateProject = capabilityAllowed(
    shell.capabilities,
    ANALYTICS_CONTROL_IDS.createProject,
  );
  const projectList = projectsQuery.data;
  const scopedList =
    projectList?.viewer.orgId === shell.workspace.id &&
    projectList.viewer.email.toLowerCase() === shell.user.email.toLowerCase()
      ? projectList
      : undefined;
  const status: ProjectsListStatus = projectsQuery.isError
    ? "error"
    : scopedList === undefined
      ? "loading"
      : "ready";

  return (
    <ProjectsListView
      initialSort={initialSort}
      status={status}
      hasTrashedSkills={trashedSkills.skills.length > 0}
      trashedSkills={
        view === "trash" ? <TrashedSkillsSection state={trashedSkills} /> : null
      }
      projects={scopedList?.projects ?? []}
      columnCapabilities={scopedList?.capabilities ?? []}
      currentUser={{
        name: shell.user.name,
        email: shell.user.email,
      }}
      categoriesByProject={categoriesByProject}
      collectionsByProject={collectionsByProject}
      collections={(collectionsQuery.data?.collections ?? []).map(
        (collection: { id: string; name: string; canManage?: boolean }) => ({
          id: collection.id,
          name: collection.name,
          canManage: collection.canManage,
        }),
      )}
      collectionsLoading={
        collectionsQuery.isPending || projectCollectionsQuery.isPending
      }
      collectionsLoadError={
        collectionsQuery.isError ||
        projectCollectionsQuery.isError ||
        (!collectionsQuery.isPending && !collectionsQuery.data) ||
        (!projectCollectionsQuery.isPending && !projectCollectionsQuery.data)
      }
      onRetryCollections={() => {
        void collectionsQuery.refetch();
        void projectCollectionsQuery.refetch();
      }}
      onToggleProjectCollection={toggleProjectCollection}
      {...(collectionId === undefined
        ? {}
        : {
            onRemoveFromCollection: (projectId: string) =>
              toggleProjectCollection(projectId, collectionId, false),
          })}
      filterOptions={{
        statuses: (statusQuery.data?.statuses ?? []).map((status) => ({
          id: status.id,
          name: status.name,
        })),
        categories: (categoryQuery.data?.categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
        })),
        collections: (collectionsQuery.data?.collections ?? []).map(
          (collection: { id: string; name: string }) => ({
            id: collection.id,
            name: collection.name,
          }),
        ),
      }}
      onTrashProject={trashProject}
      onDuplicateProject={canCreateProject ? duplicateProject : undefined}
      onRenameProject={renameProject}
      onToggleFavorite={toggleFavorite}
      onRestoreProject={restoreProject}
      onDeleteProject={deleteProject}
      onArchiveProject={archiveProject}
      onUnarchiveProject={unarchiveProject}
      archiveSettings={
        view === "archive" ? archiveSettingsQuery.data : undefined
      }
      canConfigureAutoArchive={isAdmin}
      onOpenArchiveSettings={() => void navigate("/settings/organization")}
      listView={view}
      embedded={collectionId !== undefined}
      onAddToCollection={onAddToCollection}
      onNewProjectInCollection={
        collectionId !== undefined && canCreateProject
          ? () =>
              void createProjectInCollection(collectionId).catch((error) =>
                toast.error(
                  actionErrorMessage(error) ??
                    t("notebookCreation.createFailed"),
                ),
              )
          : undefined
      }
      onClearOutputs={clearOutputs}
      search={search}
      onSearchChange={setSearch}
      onCreateProject={canCreateProject ? onCreateProject : undefined}
      onImportProject={canCreateProject ? onImportProject : undefined}
      onRetry={() => void projectsQuery.refetch()}
      errorMessage={
        projectsQuery.error instanceof Error
          ? projectsQuery.error.message
          : undefined
      }
    />
  );
}

function useTrashedSkills(
  enabled: boolean,
  canManageOrganization: boolean,
  cacheScope: string,
) {
  const options = { prefix: SKILL_TRASH_PREFIX, cacheScope, enabled };
  const personal = useResources("personal", options);
  const shared = useResources("shared", {
    ...options,
    enabled: enabled && canManageOrganization,
  });
  const skills = [
    ...(personal.data ?? []),
    ...(canManageOrganization ? (shared.data ?? []) : []),
  ]
    .flatMap((resource) => {
      const originalPath = restorePathForTrashedSkill(resource);
      return originalPath
        ? [{ ...resource, name: getSkillNameFromPath(originalPath) }]
        : [];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const pending =
    personal.isPending || (canManageOrganization && shared.isPending);
  const failed = personal.isError || (canManageOrganization && shared.isError);
  const retry = () => {
    if (personal.isError) void personal.refetch();
    if (canManageOrganization && shared.isError) void shared.refetch();
  };
  return { skills, pending, failed, retry };
}

function TrashedSkillsSection({
  state,
}: {
  state: ReturnType<typeof useTrashedSkills>;
}) {
  const t = useT();
  const restore = useUpdateResource();
  const { skills, pending, failed, retry } = state;

  if (!pending && !failed && skills.length === 0) return null;
  return (
    <section className="mx-8 my-2 rounded-md border border-border">
      <h2 className="px-3 py-2 text-sm font-semibold">
        {t("analytics.lists.trashedSkills")}
      </h2>
      {pending ? <Skeleton className="mx-3 mb-2 h-8" /> : null}
      {failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-destructive"
        >
          <span>{t("analytics.lists.trashedSkillsLoadFailed")}</span>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            {t("error.retry")}
          </Button>
        </div>
      ) : null}
      <ul>
        {skills.map((skill) => (
          <li
            key={skill.id}
            className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">{skill.name}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              aria-label={t("analytics.lists.restoreSkill", {
                name: skill.name,
              })}
              onClick={() =>
                restore.mutate(
                  { id: skill.id, restoreSkill: true },
                  {
                    onError: (error) =>
                      reportWriteFailure(error, {
                        label: t("analytics.lists.restoreFailed", {
                          noun: skill.name,
                        }),
                      }),
                  },
                )
              }
            >
              {t("analytics.lists.actionRestore")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TrashedSkills({
  canManageOrganization,
  cacheScope,
}: {
  canManageOrganization: boolean;
  cacheScope: string;
}) {
  const state = useTrashedSkills(true, canManageOrganization, cacheScope);
  return <TrashedSkillsSection state={state} />;
}
