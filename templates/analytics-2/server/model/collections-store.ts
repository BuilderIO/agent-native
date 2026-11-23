import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";
import { accessFilter } from "@agent-native/core/sharing";

import type { Collection } from "../../app/lib/model/contracts.js";
import { collectionSchema } from "../../app/lib/model/contracts.js";
import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { StoredDataError } from "./json-column.js";
import { assertReadableProject } from "./project-access.js";
import {
  type Queryable,
  type WorkspaceScope,
  requireWorkspaceScope,
} from "./scope.js";

const { collections, collectionShares, projectCollections, projects } = schema;

export const COLLECTION_ROLES = ["member", "manager"] as const;
export type CollectionRole = (typeof COLLECTION_ROLES)[number];

const SHARE_ROLE: Record<CollectionRole, "editor" | "admin"> = {
  member: "editor",
  manager: "admin",
};
type StoredRole = CollectionRole | "viewer" | "commenter";
const ROLE_OF_SHARE: Record<string, StoredRole> = {
  viewer: "viewer",
  commenter: "commenter",
  editor: "member",
  admin: "manager",
};

export type CollectionSharingInput = {
  workspaceRole?: CollectionRole | undefined;
  users?: Array<{ email: string; role: CollectionRole }> | undefined;
};

export type CollectionSharing = {
  workspaceRole: StoredRole | null;
  users: Array<{ email: string; role: StoredRole }>;
};

export const MAX_COLLECTION_USER_GRANTS = 100;

type CollectionRow = typeof collections.$inferSelect;

function toCollection(row: CollectionRow): Collection {
  return collectionSchema.parse({
    id: row.id,
    ownerEmail: row.ownerEmail,
    name: row.name,
    description: row.description,
    emoji: row.emoji ?? null,
    kind: row.kind,
    parentId: row.parentId ?? null,
    favorited: row.favorited,
    trashedAt: row.trashedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export type CollectionNode = Collection & { children: CollectionNode[] };

export type ListCollectionsFilter = WorkspaceScope & {
  trashed?: boolean;
};

async function readCollectionRow(
  scope: WorkspaceScope,
  collectionId: string,
  db: Queryable = getDb(),
): Promise<CollectionRow | null> {
  const rows = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.ownerEmail, scope.ownerEmail),
        eq(collections.orgId, scope.orgId),
        eq(collections.id, collectionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export class CollectionAccessError extends Error {
  readonly code:
    | "analytics_collection_not_found"
    | "analytics_collection_forbidden";
  readonly statusCode: 403 | 404;

  constructor(kind: "not_found" | "forbidden", message: string) {
    super(message);
    this.name = "CollectionAccessError";
    this.code =
      kind === "not_found"
        ? "analytics_collection_not_found"
        : "analytics_collection_forbidden";
    this.statusCode = kind === "not_found" ? 404 : 403;
  }
}

async function readCollectionInWorkspace(
  scope: WorkspaceScope,
  collectionId: string,
  minimum: "viewer" | "admin",
  db: Queryable,
): Promise<{ row: CollectionRow; allowed: boolean }> {
  const [row] = await db
    .select()
    .from(collections)
    .where(
      and(eq(collections.orgId, scope.orgId), eq(collections.id, collectionId)),
    )
    .limit(1);
  if (row === undefined) {
    throw new CollectionAccessError(
      "not_found",
      "That collection is not in this workspace.",
    );
  }
  const [granted] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(
        eq(collections.id, collectionId),
        accessFilter(
          collections,
          collectionShares,
          { userEmail: scope.ownerEmail, orgId: scope.orgId },
          minimum,
        ),
      ),
    )
    .limit(1);
  return { row, allowed: granted !== undefined };
}

export async function assertCollectionReadable(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  collectionId: string,
  db: Queryable = getDb(),
): Promise<CollectionRow> {
  const scope = requireWorkspaceScope(scopeInput);
  const { row, allowed } = await readCollectionInWorkspace(
    scope,
    collectionId,
    "viewer",
    db,
  );
  if (!allowed || row.trashedAt !== null) {
    throw new CollectionAccessError(
      "not_found",
      "That collection is not in this workspace.",
    );
  }
  return row;
}

async function assertCollectionManager(
  scope: WorkspaceScope,
  collectionId: string,
  db: Queryable,
): Promise<{ row: CollectionRow; owner: boolean }> {
  const { row, allowed } = await readCollectionInWorkspace(
    scope,
    collectionId,
    "admin",
    db,
  );
  if (!allowed) {
    const readable = await readCollectionInWorkspace(
      scope,
      collectionId,
      "viewer",
      db,
    );
    throw readable.allowed
      ? new CollectionAccessError(
          "forbidden",
          "You do not have permission to change that collection.",
        )
      : new CollectionAccessError(
          "not_found",
          "That collection is not in this workspace.",
        );
  }
  return {
    row,
    owner:
      row.ownerEmail.trim().toLowerCase() ===
      scope.ownerEmail.trim().toLowerCase(),
  };
}

async function assertCollection(
  scope: WorkspaceScope,
  collectionId: string,
  db: Queryable = getDb(),
): Promise<CollectionRow> {
  const row = await readCollectionRow(scope, collectionId, db);
  if (row === null) {
    throw new CollectionAccessError(
      "not_found",
      "That collection is not in this workspace.",
    );
  }
  return row;
}

/** The collection tree for an account, folders nested under their parent. */
export async function listCollections(
  filter: ListCollectionsFilter,
): Promise<CollectionNode[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(filter);
  const conditions = [
    eq(collections.orgId, scope.orgId),
    filter.trashed === true
      ? eq(collections.ownerEmail, scope.ownerEmail)
      : accessFilter(collections, collectionShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        }),
    filter.trashed === true
      ? sql`${collections.trashedAt} is not null`
      : isNull(collections.trashedAt),
  ];
  const rows = await getDb()
    .select()
    .from(collections)
    .where(and(...conditions))
    .orderBy(collections.name);
  const all = rows.map(toCollection);

  const byParent = new Map<string | null, Collection[]>();
  for (const collection of all) {
    const bucket = byParent.get(collection.parentId) ?? [];
    bucket.push(collection);
    byParent.set(collection.parentId, bucket);
  }

  const build = (
    parentId: string | null,
    seen: Set<string>,
  ): CollectionNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((collection) => !seen.has(collection.id))
      .map((collection) => {
        seen.add(collection.id);
        return { ...collection, children: build(collection.id, seen) };
      });

  // A collection whose parent is missing or trashed becomes a root, so a
  // half-deleted tree never hides projects from the sidebar.
  const roots = build(null, new Set());
  const seen = new Set<string>();
  for (const root of roots) {
    seen.add(root.id);
    for (const child of root.children) seen.add(child.id);
  }
  for (const collection of all) {
    if (seen.has(collection.id)) continue;
    roots.push({ ...collection, children: [] });
  }
  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

export type CreateCollectionInput = WorkspaceScope & {
  name: string;
  description?: string;
  emoji?: string | null;
  kind?: "collection" | "folder";
  parentId?: string | null;
  at?: string;
  collectionId?: string;
  sharing?: CollectionSharingInput;
};

export class CollectionSharingError extends Error {
  readonly code = "analytics_collection_share_invalid";
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "CollectionSharingError";
  }
}

export async function readCollectionSharing(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  collectionId: string,
  db: Queryable = getDb(),
): Promise<CollectionSharing> {
  await ensureAnalyticsDatabase();
  await assertCollectionManager(
    requireWorkspaceScope(scopeInput),
    collectionId,
    db,
  );
  const rows = await db
    .select({
      principalType: collectionShares.principalType,
      principalId: collectionShares.principalId,
      role: collectionShares.role,
    })
    .from(collectionShares)
    .where(eq(collectionShares.resourceId, collectionId))
    .orderBy(collectionShares.principalId);
  let workspaceRole: StoredRole | null = null;
  const users: CollectionSharing["users"] = [];
  for (const row of rows) {
    const role = ROLE_OF_SHARE[row.role];
    if (role === undefined) {
      throw new StoredDataError(`Unknown collection share role "${row.role}".`);
    }
    if (row.principalType === "org") workspaceRole = role;
    else if (row.principalType === "user")
      users.push({ email: row.principalId, role });
  }
  return { workspaceRole, users };
}

async function writeCollectionShares(
  scope: WorkspaceScope,
  collectionId: string,
  sharing: CollectionSharingInput,
  at: string,
  handle: Queryable,
): Promise<void> {
  const users = new Map<string, CollectionRole>();
  for (const grant of sharing.users ?? []) {
    const email = grant.email.trim().toLowerCase();
    if (email === scope.ownerEmail.trim().toLowerCase()) continue;
    users.set(email, grant.role);
  }
  if (users.size > MAX_COLLECTION_USER_GRANTS) {
    throw new CollectionSharingError(
      `A collection can be shared with at most ${MAX_COLLECTION_USER_GRANTS} people at creation.`,
    );
  }
  if (users.size > 0) {
    const members = await handle
      .select({ email: orgMembers.email })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, scope.orgId),
          inArray(sql`lower(${orgMembers.email})`, [...users.keys()]),
          isNull(orgMembers.federationRemovalPendingAt),
        ),
      );
    const known = new Set(members.map((row) => row.email.toLowerCase()));
    const outsiders = [...users.keys()].filter((email) => !known.has(email));
    if (outsiders.length > 0) {
      throw new CollectionSharingError(
        `${outsiders.join(", ")} ${outsiders.length === 1 ? "is" : "are"} not in this workspace.`,
      );
    }
  }
  const rows: Array<typeof collectionShares.$inferInsert> = [];
  if (sharing.workspaceRole !== undefined) {
    rows.push({
      id: `cshare_${randomUUID()}`,
      resourceId: collectionId,
      principalType: "org",
      principalId: scope.orgId,
      role: SHARE_ROLE[sharing.workspaceRole],
      createdBy: scope.ownerEmail,
      createdAt: at,
    });
  }
  for (const [email, role] of users) {
    rows.push({
      id: `cshare_${randomUUID()}`,
      resourceId: collectionId,
      principalType: "user",
      principalId: email,
      role: SHARE_ROLE[role],
      createdBy: scope.ownerEmail,
      createdAt: at,
    });
  }
  if (rows.length > 0) await handle.insert(collectionShares).values(rows);
}

function normalizeCollectionEmoji(
  emoji: string | null | undefined,
): string | null | undefined {
  if (emoji === undefined) return undefined;
  if (emoji === null) return null;
  const trimmed = emoji.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 16) {
    throw new Error("Collection emoji must be 16 characters or fewer.");
  }
  return trimmed;
}

export async function createCollection(
  input: CreateCollectionInput,
  db?: Queryable,
): Promise<Collection> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const name = input.name.trim();
  if (name === "") throw new Error("A collection needs a name.");
  const emoji = normalizeCollectionEmoji(input.emoji) ?? null;

  const write = async (handle: Queryable): Promise<Collection> => {
    if (input.parentId !== undefined && input.parentId !== null) {
      await assertCollection(scope, input.parentId, handle);
    }

    const timestamp = input.at ?? nowIso();
    const id = input.collectionId ?? newId("col");
    await handle.insert(collections).values({
      id,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      name,
      description: input.description ?? "",
      emoji,
      kind: input.kind ?? "collection",
      parentId: input.parentId ?? null,
      favorited: false,
      trashedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (input.sharing !== undefined) {
      await writeCollectionShares(scope, id, input.sharing, timestamp, handle);
    }
    const row = await readCollectionRow(scope, id, handle);
    if (row === null) throw new Error("The collection could not be read back.");
    return toCollection(row);
  };

  // The parent check and the insert share one handle, so a parent removed
  // mid-write cannot leave a child pointing at nothing.
  if (db !== undefined) return write(db);
  return getDb().transaction(write);
}

/**
 * Permanently deletes one collection. Its project links go with it (the link
 * rows cascade), and the projects themselves are untouched — the same rule the
 * source's delete dialog states.
 */
export async function deleteCollection(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  collectionId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertCollection(scope, collectionId);
  await getDb()
    .delete(collections)
    .where(
      and(eq(collections.orgId, scope.orgId), eq(collections.id, collectionId)),
    );
}

export type UpdateCollectionInput = WorkspaceScope & {
  collectionId: string;
  name?: string;
  description?: string;
  emoji?: string | null;
  parentId?: string | null;
  favorited?: boolean;
  trashed?: boolean;
};

export async function updateCollection(
  input: UpdateCollectionInput,
  db?: Queryable,
): Promise<Collection> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const emoji = normalizeCollectionEmoji(input.emoji);

  const write = async (handle: Queryable): Promise<Collection> => {
    const { owner } = await assertCollectionManager(
      scope,
      input.collectionId,
      handle,
    );
    if (
      !owner &&
      (input.parentId !== undefined ||
        input.favorited !== undefined ||
        input.trashed !== undefined)
    ) {
      throw new CollectionAccessError(
        "forbidden",
        "Only the owner can move, star or trash a collection.",
      );
    }
    if (
      input.parentId !== undefined &&
      input.parentId !== null &&
      input.parentId !== input.collectionId
    ) {
      await assertCollection(scope, input.parentId, handle);
    }
    const timestamp = nowIso();
    const changes: Partial<typeof collections.$inferInsert> = {
      updatedAt: timestamp,
    };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name === "") throw new Error("A collection needs a name.");
      changes.name = name;
    }
    if (input.description !== undefined)
      changes.description = input.description;
    if (emoji !== undefined) changes.emoji = emoji;
    if (input.parentId !== undefined) changes.parentId = input.parentId;
    if (input.favorited !== undefined) changes.favorited = input.favorited;
    if (input.trashed !== undefined) {
      changes.trashedAt = input.trashed ? timestamp : null;
    }

    await handle
      .update(collections)
      .set(changes)
      .where(
        and(
          eq(collections.orgId, scope.orgId),
          eq(collections.id, input.collectionId),
        ),
      );
    const [row] = await handle
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.orgId, scope.orgId),
          eq(collections.id, input.collectionId),
        ),
      )
      .limit(1);
    if (row === undefined)
      throw new CollectionAccessError(
        "not_found",
        "The collection is not in this workspace.",
      );
    return toCollection(row);
  };

  if (db !== undefined) return write(db);
  return getDb().transaction(write);
}

export type CollectionLinkInput = WorkspaceScope & {
  projectId: string;
  collectionId: string;
  at?: string;
};

/**
 * Links a readable project to a collection the caller manages. A link is not
 * a grant: the project keeps its own sharing, and a private project the caller
 * cannot read stays unreachable. Both halves are checked against the request
 * scope, so one workspace cannot join another's rows.
 */
export async function addProjectToCollection(
  input: CollectionLinkInput,
  db?: Queryable,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);

  const write = async (handle: Queryable): Promise<void> => {
    await assertReadableProject(scope, input.projectId, handle);
    await assertCollectionManager(scope, input.collectionId, handle);
    await handle
      .insert(projectCollections)
      .values({
        projectId: input.projectId,
        collectionId: input.collectionId,
        addedAt: input.at ?? nowIso(),
      })
      .onConflictDoNothing();
  };

  // Both access checks and the link share one handle.
  if (db !== undefined) return write(db);
  await getDb().transaction(write);
}

export async function removeProjectFromCollection(
  input: CollectionLinkInput,
  db?: Queryable,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);

  const write = async (handle: Queryable): Promise<void> => {
    await assertReadableProject(scope, input.projectId, handle);
    await assertCollectionManager(scope, input.collectionId, handle);
    await handle
      .delete(projectCollections)
      .where(
        and(
          eq(projectCollections.projectId, input.projectId),
          eq(projectCollections.collectionId, input.collectionId),
        ),
      );
  };

  if (db !== undefined) return write(db);
  await getDb().transaction(write);
}

export type ProjectCollectionMembership = {
  projectId: string;
  collectionIds: string[];
};

/**
 * Every project-to-collection membership the caller can see. A link is only
 * visible when the caller can read both the project and the collection, so a
 * revoked collection share or a private project never leaks an id.
 */
export async function readProjectCollections(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
): Promise<ProjectCollectionMembership[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const viewer = { userEmail: scope.ownerEmail, orgId: scope.orgId };
  const rows = await getDb()
    .select({
      projectId: projectCollections.projectId,
      collectionId: projectCollections.collectionId,
    })
    .from(projectCollections)
    .innerJoin(projects, eq(projectCollections.projectId, projects.id))
    .innerJoin(collections, eq(projectCollections.collectionId, collections.id))
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        accessFilter(projects, schema.projectShares, viewer),
        eq(collections.orgId, scope.orgId),
        accessFilter(collections, collectionShares, viewer),
        isNull(collections.trashedAt),
      ),
    )
    .orderBy(projectCollections.addedAt);
  const byProject = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byProject.get(row.projectId);
    if (existing === undefined)
      byProject.set(row.projectId, [row.collectionId]);
    else existing.push(row.collectionId);
  }
  return [...byProject].map(([projectId, collectionIds]) => ({
    projectId,
    collectionIds,
  }));
}

/** Collections a readable project appears in, limited to readable collections. */
export async function projectCollectionIds(
  scopeInput: WorkspaceScope,
  projectId: string,
): Promise<string[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertReadableProject(scope, projectId);
  const linked = await readProjectCollections(scope);
  return (
    linked.find((link) => link.projectId === projectId)?.collectionIds ?? []
  );
}
