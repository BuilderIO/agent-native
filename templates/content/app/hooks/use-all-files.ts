import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { Project, FileTreeResponse, FileNode } from "@shared/api";
import { SHARED_SLUG } from "./use-projects";

export interface FileEntry {
  projectSlug: string;
  filePath: string;
  fileName: string;
  title: string;
}

function flattenTree(nodes: FileNode[], projectSlug: string): FileEntry[] {
  const results: FileEntry[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      results.push({
        projectSlug,
        filePath: node.path,
        fileName: node.name,
        title: node.title || node.name,
      });
    }
    if (node.children) {
      results.push(...flattenTree(node.children, projectSlug));
    }
  }
  return results;
}

/**
 * Fetches file trees for all projects + shared resources,
 * and returns a flat list of all file entries for searching.
 * Only runs when `projects` is non-empty (i.e. dialog is open).
 */
export function useAllFiles(projects: Project[]) {
  const slugs = useMemo(() => {
    const list = projects.map((p) => p.slug);
    list.push(SHARED_SLUG);
    return list;
  }, [projects]);

  const queries = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["fileTree", slug],
      queryFn: async (): Promise<{ slug: string; tree: FileNode[] }> => {
        const url =
          slug === SHARED_SLUG
            ? "/api/shared/tree"
            : `/api/projects/${slug}/tree`;
        const res = await authFetch(url);
        if (!res.ok) return { slug, tree: [] };
        const data: FileTreeResponse = await res.json();
        return { slug, tree: data.tree };
      },
      staleTime: 10_000,
      enabled: slugs.length > 0,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  const entries = useMemo(() => {
    const all: FileEntry[] = [];
    for (const q of queries) {
      if (q.data) {
        all.push(...flattenTree(q.data.tree, q.data.slug));
      }
    }
    return all;
  }, [queries]);

  return { entries, isLoading };
}
