import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type {
  Project,
  ProjectListResponse,
  ProjectCreateResponse,
  ProjectGroupCreateResponse,
  ProjectMoveResponse,
  FileTreeResponse,
  FileContentResponse,
  FileCreateResponse,
  FileSaveResponse,
  VersionHistoryListResponse,
  VersionContentResponse,
} from "@shared/api";

export type { ProjectListResponse };

export function useProjects() {
  return useQuery<ProjectListResponse>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await authFetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });
}

export function getProjectRouteSlug(project: Pick<Project, "slug" | "canonicalSlug">): string {
  return project.canonicalSlug || project.slug;
}

export function findProjectByRouteSlug(
  projects: Project[] | undefined,
  routeSlug: string | null | undefined
): Project | undefined {
  if (!projects || !routeSlug) return undefined;
  return projects.find(
    (project) => project.canonicalSlug === routeSlug || project.slug === routeSlug
  );
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<ProjectCreateResponse, Error, { name: string; group?: string; builderHandle?: string; builderDocsId?: string; builderModel?: "blog-article" | "docs-content"; fullData?: any; blocksString?: string }>({
    mutationFn: async ({ name, group, builderHandle, builderDocsId, builderModel, fullData, blocksString }) => {
      const res = await authFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, group, builderHandle, builderDocsId, builderModel, fullData, blocksString }),
      });
      if (!res.ok) throw new Error("Failed to create project");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useCreateProjectGroup() {
  const qc = useQueryClient();
  return useMutation<ProjectGroupCreateResponse, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      const res = await authFetch("/api/projects/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<void, Error, { slug: string }>({
    mutationFn: async ({ slug }) => {
      const res = await authFetch(`/api/projects/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        let message = "Failed to delete project";

        try {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await res.json();
            if (typeof data?.error === "string" && data.error) {
              message = data.error;
            }
          } else {
            const text = await res.text();
            if (text) {
              message = text;
            }
          }
        } catch {
          // Fall back to the default message.
        }

        throw new Error(message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation<void, Error, { slug: string; name: string }>({
    mutationFn: async ({ slug, name }) => {
      const res = await authFetch(`/api/projects/${slug}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to rename project");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useMoveProject() {
  const qc = useQueryClient();
  return useMutation<ProjectMoveResponse, Error, { slug: string; group?: string }>(
    {
      mutationFn: async ({ slug, group }) => {
        const res = await authFetch(`/api/projects/${slug}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group }),
        });
        if (!res.ok) throw new Error("Failed to move project");
        return res.json();
      },
      onSuccess: (data, vars) => {
        qc.invalidateQueries({ queryKey: ["projects"] });
        qc.invalidateQueries({ queryKey: ["fileTree", vars.slug] });
        if (data?.slug) {
          qc.invalidateQueries({ queryKey: ["fileTree", data.slug] });
        }
      },
    }
  );
}

export function useUpdateProjectMeta() {
  const qc = useQueryClient();
  return useMutation<void, Error, { slug: string; isPrivate?: boolean; ownerId?: string; activeDraft?: string }>({
    mutationFn: async ({ slug, isPrivate, ownerId, activeDraft }) => {
      const res = await authFetch(`/api/projects/${slug}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate, ownerId, activeDraft }),
      });
      if (!res.ok) throw new Error("Failed to update project");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/**
 * Returns the correct URL prefix for a workspace.
 * Legacy workspaces use /<slug>, new prefixed workspaces use /workspace/<slug>.
 */
export function workspaceUrl(slug: string, prefixed: boolean): string {
  return prefixed ? `/workspace/${slug}` : `/${slug}`;
}

export const SHARED_SLUG = "__shared__";
export const WORKSPACE_SHARED_PREFIX = "__workspace_shared__:";

export function workspaceSharedSlug(workspace: string): string {
  return `${WORKSPACE_SHARED_PREFIX}${workspace}`;
}

export function isWorkspaceSharedSlug(slug: string): boolean {
  return slug.startsWith(WORKSPACE_SHARED_PREFIX);
}

export function getWorkspaceFromSharedSlug(slug: string): string {
  return slug.slice(WORKSPACE_SHARED_PREFIX.length);
}

function getApiBase(projectSlug: string, operation: "tree" | "file"): string {
  if (projectSlug === SHARED_SLUG) {
    return `/api/shared/${operation}`;
  }
  if (isWorkspaceSharedSlug(projectSlug)) {
    const workspace = getWorkspaceFromSharedSlug(projectSlug);
    return `/api/workspace/${workspace}/shared/${operation}`;
  }
  return `/api/projects/${projectSlug}/${operation}`;
}

export function useFileTree(projectSlug: string | null) {
  return useQuery<FileTreeResponse>({
    queryKey: ["fileTree", projectSlug],
    queryFn: async () => {
      const url = getApiBase(projectSlug!, "tree");
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Failed to fetch file tree");
      return res.json();
    },
    enabled: !!projectSlug,
  });
}

export function useFileContent(projectSlug: string | null, filePath: string | null) {
  return useQuery<FileContentResponse>({
    queryKey: ["file", projectSlug, filePath],
    queryFn: async () => {
      const base = getApiBase(projectSlug!, "file");
      const res = await authFetch(
        `${base}?path=${encodeURIComponent(filePath!)}`
      );
      if (!res.ok) throw new Error("Failed to fetch file");
      return res.json();
    },
    enabled: !!projectSlug && !!filePath,
    // Removed refetchInterval - we'll rely on explicit invalidation only
    // This prevents unnecessary refetches that cause scroll jumps
  });
}

export function useSaveFile() {
  const qc = useQueryClient();
  return useMutation<FileSaveResponse, Error, {
    projectSlug: string;
    filePath: string;
    content: string;
  }>({
    mutationFn: async ({
      projectSlug,
      filePath,
      content,
    }: {
      projectSlug: string;
      filePath: string;
      content: string;
    }) => {
      const base = getApiBase(projectSlug, "file");
      const res = await authFetch(
        `${base}?path=${encodeURIComponent(filePath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!res.ok) throw new Error("Failed to save file");
      return res.json();
    },
    onSuccess: (data, vars) => {
      // Update the cache directly instead of invalidating
      // This prevents refetch and scroll position loss
      qc.setQueryData(
        ["file", vars.projectSlug, vars.filePath],
        (old: FileContentResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            content: vars.content,
            updatedAt: data.updatedAt || new Date().toISOString(),
          };
        }
      );
      // Still update file tree, project metadata, and history queries
      qc.invalidateQueries({ queryKey: ["fileTree", vars.projectSlug] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["versionHistory", vars.projectSlug, vars.filePath] });
      qc.invalidateQueries({ queryKey: ["versionContent", vars.projectSlug, vars.filePath] });
    },
  });
}

export function useVersionHistory(
  projectSlug: string | null,
  filePath: string | null,
  enabled: boolean = true
) {
  return useQuery<VersionHistoryListResponse>({
    queryKey: ["versionHistory", projectSlug, filePath],
    queryFn: async () => {
      const res = await authFetch(
        `/api/projects/${projectSlug}/version-history?path=${encodeURIComponent(filePath!)}`
      );
      if (!res.ok) throw new Error("Failed to fetch version history");
      return res.json();
    },
    enabled: enabled && !!projectSlug && !!filePath,
  });
}

export function useVersionContent(
  projectSlug: string | null,
  filePath: string | null,
  versionId: string | null,
  enabled: boolean = true
) {
  return useQuery<VersionContentResponse>({
    queryKey: ["versionContent", projectSlug, filePath, versionId],
    queryFn: async () => {
      const res = await authFetch(
        `/api/projects/${projectSlug}/version-history/${versionId}?path=${encodeURIComponent(filePath!)}`
      );
      if (!res.ok) throw new Error("Failed to fetch version content");
      return res.json();
    },
    enabled: enabled && !!projectSlug && !!filePath && !!versionId,
  });
}

export function useCreateFile() {
  const qc = useQueryClient();
  return useMutation<FileCreateResponse, Error, {
    projectSlug: string;
    name: string;
    type: "file" | "directory";
    parentPath?: string;
    content?: string;
  }>({
    mutationFn: async ({ projectSlug, name, type, parentPath, content }) => {
      const url = getApiBase(projectSlug, "file");
      const res = await authFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, parentPath, content }),
      });
      if (!res.ok) throw new Error("Failed to create file");
      return res.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["fileTree", vars.projectSlug] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectSlug,
      filePath,
    }: {
      projectSlug: string;
      filePath: string;
    }) => {
      const base = getApiBase(projectSlug, "file");
      const res = await authFetch(
        `${base}?path=${encodeURIComponent(filePath)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete file");
      return res.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["fileTree", vars.projectSlug] });
    },
  });
}
