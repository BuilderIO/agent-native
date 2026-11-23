import { listThreads } from "@agent-native/core/server";
import { z } from "zod";

import { resourcePath } from "../../app/lib/navigation-contract.js";
import { workspaceChatScope } from "../../app/lib/workspace-chat-scope.js";
import { listCollections, type CollectionNode } from "./collections-store.js";
import { hasConfiguredDataConnection } from "./data-connections.js";
import { collapseRecentRows } from "./recent-rows.js";
import type { WorkspaceScope } from "./scope.js";
import { readShellProjects } from "./shell-projects.js";

const rowSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["project", "thread", "collection", "data"]),
  href: z.string(),
});
export const workspaceActivitySchema = z.object({
  recents: z.array(rowSchema),
  favorites: z.array(rowSchema),
  hasDataConnection: z.boolean(),
  homeRecents: z.object({
    projects: z.array(
      rowSchema.extend({
        updatedAt: z.string(),
        lastViewedAt: z.string().nullable(),
        ownerLabel: z.string(),
        favorited: z.boolean(),
        notebookHref: z.string().optional(),
        canEdit: z.boolean(),
      }),
    ),
    threads: z.array(
      rowSchema.extend({ updatedAt: z.string(), ownerLabel: z.string() }),
    ),
  }),
});

function flattenCollections(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.flatMap((node) => [node, ...flattenCollections(node.children)]);
}

async function currentWorkspaceThreads(
  ownerEmail: string,
  orgId: string,
  appId: string,
) {
  const matches: Awaited<ReturnType<typeof listThreads>> = [];
  const pageSize = 50;
  for (let offset = 0; ; offset += pageSize) {
    const page = await listThreads(ownerEmail, {
      limit: pageSize,
      offset,
      orgId,
      ownership: "mine",
      includeExternal: false,
      sourceAppId: appId,
      scope: workspaceChatScope(orgId, appId),
      collapseEdits: true,
    });
    matches.push(...page.filter((thread) => thread.orgId === orgId));
    if (matches.length >= 10 || page.length < pageSize)
      return matches.slice(0, 10);
  }
}

export async function readWorkspaceActivity(
  scope: WorkspaceScope,
  appId: string,
) {
  const [projects, tree, threads, hasDataConnection] = await Promise.all([
    readShellProjects(scope),
    listCollections(scope),
    currentWorkspaceThreads(scope.ownerEmail, scope.orgId, appId),
    hasConfiguredDataConnection(),
  ]);
  const collections = flattenCollections(tree);
  const projectRows = projects.recent.map((project) => ({
    id: project.id,
    title: project.title,
    kind: "project" as const,
    href: project.publishedVersionId
      ? `/app/${encodeURIComponent(project.id)}/latest`
      : `/project/${encodeURIComponent(project.id)}/latest`,
    notebookHref: project.publishedVersionId
      ? `/project/${encodeURIComponent(project.id)}/latest`
      : undefined,
    canEdit: true,
    favorited: project.favorited,
    timestamp: project.lastOpenedAt ?? project.updatedAt,
    updatedAt: project.updatedAt,
    lastViewedAt: project.lastOpenedAt,
    ownerLabel: "You",
  }));
  const threadRows = threads.map((thread) => ({
    id: thread.id,
    title: thread.title || "New thread",
    kind: "thread" as const,
    href: `/thread/${encodeURIComponent(thread.id)}`,
    timestamp: new Date(thread.updatedAt).toISOString(),
    updatedAt: new Date(thread.updatedAt).toISOString(),
    ownerLabel: "You",
  }));
  const recents = collapseRecentRows([...projectRows, ...threadRows])
    .slice(0, 10)
    .map(({ id, title, kind, href }) => ({ id, title, kind, href }));
  const favorites = [
    ...projects.favorites.map(({ id, title, publishedVersionId }) => ({
      id,
      title,
      kind: "project" as const,
      href: publishedVersionId
        ? `/app/${encodeURIComponent(id)}/latest`
        : `/project/${encodeURIComponent(id)}/latest`,
    })),
    ...collections
      .filter((item) => item.favorited)
      .map((item) => ({
        id: item.id,
        title: item.name,
        kind: "collection" as const,
        href: resourcePath("collection", item.id),
      })),
  ];
  return {
    recents,
    favorites,
    hasDataConnection,
    homeRecents: {
      projects: projectRows.map(({ timestamp, ...row }) => row),
      threads: collapseRecentRows(threadRows)
        .slice(0, 10)
        .map(({ id, title, kind, href, updatedAt, ownerLabel }) => ({
          id,
          title,
          kind,
          href,
          updatedAt,
          ownerLabel,
        })),
    },
    collections: collections.map(({ id, name }) => ({ id, name })),
  };
}
