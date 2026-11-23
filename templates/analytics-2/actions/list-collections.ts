import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray, isNull, sql } from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfilesWithStatus } from "@agent-native/core/user-profile/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { listCollections } from "../server/model/collections-store.js";

const { projectCollections, projects } = schema;

const collectionSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  emoji: z.string().nullable(),
  kind: z.enum(["collection", "folder"]),
  parentId: z.string().nullable(),
  favorited: z.boolean(),
  /** Projects in this collection that are not archived or trashed. */
  projectCount: z.number().int().min(0),
  /** Whether the signed-in member created it, for the collection's byline. */
  ownedByYou: z.boolean(),
  canManage: z.boolean(),
  /**
   * Whether the collection is shared with the whole workspace. The collections
   * table carries the same visibility column every ownable resource has, so this
   * is read, not inferred.
   */
  sharedWithWorkspace: z.boolean(),
  isPrivate: z.boolean(),
  /**
   * Individual members the collection is shared with, excluding the signed-in
   * member and the collection owner, so the owner sees every recipient and a
   * recipient does not count their own grant.
   */
  sharedWithUserCount: z.number().int().min(0),
  members: z.array(
    z.object({
      email: z.string(),
      name: z.string().nullable(),
      role: z.enum(["owner", "manager", "member"]),
    }),
  ),
});

/**
 * Collections with the counts and description a reader sees on the list and on a
 * collection's own page. The collections table and its project links already
 * exist; this exposes them so the Collections screen is not an empty frame.
 */
export default defineAction({
  mcpTool: true,
  description:
    "List the collections in the current workspace with their description, the number of live projects in each, and whether the signed-in member created them.",
  schema: z
    .object({
      id: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .optional()
        .describe("Return only this collection, for a collection's own page."),
    })
    .strict(),
  outputSchema: z.object({
    collections: z.array(collectionSummary),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ id }) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    const tree = await listCollections(scope);
    const flattened: Array<(typeof tree)[number]> = [];
    const visit = (nodes: Array<(typeof tree)[number]>) => {
      for (const node of nodes) {
        flattened.push(node);
        visit(node.children as Array<(typeof tree)[number]>);
      }
    };
    visit(tree);
    const wanted = id ? flattened.filter((node) => node.id === id) : flattened;
    if (wanted.length === 0) return { collections: [] };

    const counts = await getDb()
      .select({
        collectionId: projectCollections.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectCollections)
      .innerJoin(projects, eq(projects.id, projectCollections.projectId))
      .where(
        and(
          inArray(
            projectCollections.collectionId,
            wanted.map((node) => node.id),
          ),
          eq(projects.orgId, current.orgId),
          accessFilter(projects, schema.projectShares, {
            userEmail: current.ownerEmail,
            orgId: current.orgId,
          }),
          isNull(projects.trashedAt),
          isNull(projects.archivedAt),
        ),
      )
      .groupBy(projectCollections.collectionId);
    const countsById = new Map(
      counts.map((row) => [row.collectionId, row.count]),
    );
    const visibilityRows = await getDb()
      .select({
        id: schema.collections.id,
        visibility: schema.collections.visibility,
      })
      .from(schema.collections)
      .where(
        inArray(
          schema.collections.id,
          wanted.map((node) => node.id),
        ),
      );
    const orgGrantRows = await getDb()
      .select({
        id: schema.collectionShares.resourceId,
        role: schema.collectionShares.role,
      })
      .from(schema.collectionShares)
      .where(
        and(
          inArray(
            schema.collectionShares.resourceId,
            wanted.map((node) => node.id),
          ),
          eq(schema.collectionShares.principalType, "org"),
          eq(schema.collectionShares.principalId, current.orgId),
        ),
      );
    const orgGranted = new Set(orgGrantRows.map((row) => row.id));
    const orgManagerGranted = new Set(
      orgGrantRows.filter((row) => row.role === "admin").map((row) => row.id),
    );
    const userGrantRows = await getDb()
      .select({
        id: schema.collectionShares.resourceId,
        email: schema.collectionShares.principalId,
        role: schema.collectionShares.role,
      })
      .from(schema.collectionShares)
      .where(
        and(
          inArray(
            schema.collectionShares.resourceId,
            wanted.map((node) => node.id),
          ),
          eq(schema.collectionShares.principalType, "user"),
        ),
      );
    const visibilityById = new Map(
      visibilityRows.map((row) => [
        row.id,
        orgGranted.has(row.id) ? "org" : row.visibility,
      ]),
    );
    const normalizedEmail = current.ownerEmail.trim().toLowerCase();
    const ownerById = new Map(
      wanted.map((node) => [node.id, node.ownerEmail.trim().toLowerCase()]),
    );
    const grantedUsers = new Map<string, Set<string>>();
    const directMemberGrants = new Map<
      string,
      Map<string, "manager" | "member">
    >();
    const allMemberEmails = new Set<string>();
    for (const node of wanted) {
      allMemberEmails.add(node.ownerEmail.trim().toLowerCase());
    }
    for (const row of userGrantRows) {
      const email = row.email.trim().toLowerCase();
      allMemberEmails.add(email);
      if (email !== ownerById.get(row.id)) {
        const roles = directMemberGrants.get(row.id) ?? new Map();
        const mappedRole: "manager" | "member" =
          row.role === "admin" ? "manager" : "member";
        if (roles.get(email) !== "manager") {
          roles.set(email, mappedRole);
        }
        directMemberGrants.set(row.id, roles);
      }
      if (email === normalizedEmail || email === ownerById.get(row.id))
        continue;
      const users = grantedUsers.get(row.id) ?? new Set<string>();
      users.add(email);
      grantedUsers.set(row.id, users);
    }
    const { profiles } = await getUserProfilesWithStatus([...allMemberEmails]);
    const displayNameFor = (email: string): string | null => {
      const profileName = profiles.get(email)?.name.trim();
      if (profileName && !isEmailDerivedName(profileName, email)) {
        return profileName;
      }
      if (email === normalizedEmail) {
        const requestName = current.request.userName?.trim();
        if (requestName && !isEmailDerivedName(requestName, email)) {
          return requestName;
        }
      }
      return null;
    };

    return {
      collections: wanted.map((node) => {
        const ownerEmail = node.ownerEmail.trim().toLowerCase();
        const isOwner = ownerEmail === normalizedEmail;
        const grants = directMemberGrants.get(node.id);
        const viewerIsManager =
          isOwner ||
          orgManagerGranted.has(node.id) ||
          grants?.get(normalizedEmail) === "manager";
        const sharedMembers = grants
          ? [...grants.entries()]
              .filter(([email]) => viewerIsManager || email === normalizedEmail)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([email, role]) => ({
                email,
                name: displayNameFor(email),
                role,
              }))
          : [];
        return {
          id: node.id,
          name: node.name,
          description: node.description,
          emoji: node.emoji ?? null,
          kind: node.kind,
          parentId: node.parentId,
          favorited: node.favorited,
          projectCount: countsById.get(node.id) ?? 0,
          ownedByYou: isOwner,
          canManage: viewerIsManager,
          sharedWithWorkspace: visibilityById.get(node.id) === "org",
          isPrivate: visibilityById.get(node.id) === "private",
          sharedWithUserCount: grantedUsers.get(node.id)?.size ?? 0,
          members: [
            {
              email: ownerEmail,
              name: displayNameFor(ownerEmail),
              role: "owner" as const,
            },
            ...sharedMembers,
          ],
        };
      }),
    };
  },
});
