import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { orgMembers } from "@agent-native/core/org";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { and, asc, eq, gt, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import { capabilityScopeRefSchema } from "../../shared/capabilities.js";
import { revisionSchema } from "../../shared/notebook-snapshot-contract.js";
import {
  type findPublishedAppColleaguesInput,
  type listPublishedAppAccessInput,
  type PublishedAppAccess,
  type PublishedAppAccessChange,
  type PublishedAppAccessReceipt,
  type PublishedAppColleagues,
  type PublishedAppGrant,
  setPublishedAppAccessOutput,
} from "../../shared/project-sharing.js";
import { getDb, schema } from "../db/index.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCapability,
} from "../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { digest } from "./notebook-execution/planner.js";
import { notebookRunWork } from "./notebook-execution/schema.js";
import { getReadableProjectRow } from "./project-access.js";
import {
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import type { Queryable, WorkspaceScope } from "./scope.js";

const {
  projects,
  projectShares,
  projectReleases,
  projectVersions,
  publishedAppSessions,
  publishedAppGrants: grants,
  publishedAppShareReceipts: receipts,
} = schema;
const copy = notebookMessages.publishedAppSharing;
const directoryUsers = pgTable("user", {
  email: text("email").notNull(),
  name: text("name").notNull(),
});
const memberFields = {
  id: orgMembers.id,
  email: orgMembers.email,
  name: directoryUsers.name,
};
const appGrantFields = {
  id: grants.id,
  memberId: grants.memberId,
  email: orgMembers.email,
  name: directoryUsers.name,
  role: grants.role,
  createdAt: grants.createdAt,
};
type Member = { id: string; email: string; name: string | null };

function displayName(name: string | null, fallback: string) {
  return (name?.trim() || fallback).slice(0, 200);
}

function person(member: Member) {
  return { id: member.id, displayName: displayName(member.name, member.email) };
}

export function publishedAppMemberDirectory(orgId: string, db: Queryable) {
  return db
    .select(memberFields)
    .from(orgMembers)
    .leftJoin(directoryUsers, eq(directoryUsers.email, orgMembers.email))
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        inArray(orgMembers.role, ["owner", "admin", "member"]),
        isNull(orgMembers.federationRemovalPendingAt),
      ),
    )
    .as("directory");
}

function projectNotFound(): never {
  return fail(copy.denied, {
    statusCode: 404,
    errorCode: "project_not_found",
  });
}

async function cancelRevokedViewerRuns(
  tx: Queryable,
  scope: WorkspaceScope,
  projectId: string,
) {
  const legacy = await getReadableProjectRow(scope, projectId, tx);
  if (legacy && (await projectAccessLevel(scope, legacy, [], tx))) return;
  const pending = await tx
    .selectDistinct({ runId: notebookRunWork.runId })
    .from(publishedAppSessions)
    .innerJoin(
      notebookRunWork,
      and(
        eq(notebookRunWork.runId, publishedAppSessions.runId),
        eq(notebookRunWork.done, false),
      ),
    )
    .where(
      and(
        eq(publishedAppSessions.orgId, scope.orgId),
        eq(publishedAppSessions.projectId, projectId),
        eq(publishedAppSessions.ownerEmail, scope.ownerEmail),
      ),
    )
    .orderBy(asc(notebookRunWork.runId))
    .limit(100);
  if (pending.length === 0) return;
  const { notebookRunStore } = await import("./notebook-execution/service.js");
  for (const { runId } of pending) {
    await notebookRunStore.cancel(
      { ...scope, caller: "frontend" },
      runId,
      undefined,
      tx,
    );
  }
}

async function sharingManager(projectId: string) {
  const current = await requireCurrentWorkspace();
  await ensureAnalyticsDatabase();
  const project = await getReadableProjectRow(current, projectId);
  if (!project || project.trashedAt) projectNotFound();
  await requireCapability(
    ANALYTICS_CONTROL_IDS.manageAppSharing,
    capabilityScopeRefSchema.parse({
      kind: "project",
      workspaceId: current.orgId,
      projectId,
    }),
  );
  return { current, project };
}

async function publishedHref(
  db: Queryable,
  project: typeof projects.$inferSelect,
) {
  if (!project.publishedVersionId) return null;
  const [release] = await db
    .select({ id: projectReleases.id })
    .from(projectReleases)
    .where(
      and(
        eq(projectReleases.projectId, project.id),
        eq(projectReleases.id, project.publishedVersionId),
        eq(projectReleases.orgId, project.orgId ?? ""),
      ),
    )
    .limit(1);
  if (release)
    return `${getConfiguredAppBasePath()}/app/${encodeURIComponent(project.id)}/latest`;
  const [legacy] = await db
    .select({ id: projectVersions.id })
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.projectId, project.id),
        eq(projectVersions.id, project.publishedVersionId),
        eq(projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  return legacy
    ? `${getConfiguredAppBasePath()}/app/${encodeURIComponent(project.id)}/latest`
    : null;
}

function scopedGrants(orgId: string, projectId: string, db: Queryable) {
  return db
    .select(appGrantFields)
    .from(grants)
    .leftJoin(
      orgMembers,
      and(
        eq(orgMembers.id, grants.memberId),
        eq(orgMembers.orgId, grants.orgId),
      ),
    )
    .leftJoin(directoryUsers, eq(directoryUsers.email, orgMembers.email))
    .where(
      and(
        eq(grants.orgId, orgId),
        eq(grants.projectId, projectId),
        isNull(grants.revokedAt),
      ),
    )
    .as("active_grants");
}

function projectGrant(row: {
  id: string;
  memberId: string;
  email: string | null;
  name: string | null;
  role: "app_viewer";
  createdAt: string;
}): PublishedAppGrant {
  return {
    id: row.id,
    person: {
      id: row.memberId,
      displayName: displayName(row.name, row.email ?? row.memberId),
    },
    role: row.role,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listPublishedAppAccess({
  projectId,
  cursor,
  limit,
}: z.infer<typeof listPublishedAppAccessInput>): Promise<PublishedAppAccess> {
  const { current, project } = await sharingManager(projectId);
  const db = getDb();
  const active = scopedGrants(current.orgId, projectId, db);
  const members = publishedAppMemberDirectory(current.orgId, db);
  const [rows, legacy, [owner], appHref] = await Promise.all([
    db
      .select()
      .from(active)
      .where(cursor ? gt(active.id, cursor) : undefined)
      .orderBy(asc(active.id))
      .limit(limit + 1),
    db
      .select({
        id: projectShares.id,
        principalId: projectShares.principalId,
        role: projectShares.role,
        createdAt: projectShares.createdAt,
        memberId: members.id,
        name: members.name,
      })
      .from(projectShares)
      .leftJoin(
        members,
        and(
          eq(projectShares.principalType, "user"),
          eq(projectShares.principalId, members.email),
        ),
      )
      .where(
        and(
          eq(projectShares.resourceId, projectId),
          cursor ? gt(projectShares.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(projectShares.id))
      .limit(limit + 1),
    db
      .select()
      .from(members)
      .where(eq(members.email, project.ownerEmail))
      .limit(1),
    publishedHref(db, project),
  ]);
  const projected = [
    ...rows.map(projectGrant),
    ...legacy.map(
      ({
        id,
        principalId,
        role,
        createdAt,
        memberId,
        name,
      }): PublishedAppGrant => ({
        id,
        person: {
          id: memberId ?? principalId,
          displayName: displayName(name, principalId),
        },
        role:
          role === "admin"
            ? "manager"
            : role === "editor"
              ? "editor"
              : "legacy_reader",
        createdAt: new Date(createdAt).toISOString(),
      }),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    projectId,
    revision: revisionSchema.parse(String(project.appSharingRevision)),
    owner: owner
      ? person(owner)
      : {
          id: project.ownerEmail,
          displayName: project.ownerEmail.slice(0, 200),
        },
    generalAccess: project.visibility === "org" ? "org" : "private",
    supportedRoles: appHref ? ["app_viewer"] : [],
    grants: projected.slice(0, limit),
    nextCursor:
      projected.length > limit ? (projected[limit - 1]?.id ?? null) : null,
    appHref,
  };
}

export async function findPublishedAppColleagues({
  projectId,
  query,
  cursor,
}: z.infer<
  typeof findPublishedAppColleaguesInput
>): Promise<PublishedAppColleagues> {
  const { current, project } = await sharingManager(projectId);
  const db = getDb();
  const members = publishedAppMemberDirectory(current.orgId, db);
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select()
    .from(members)
    .where(
      and(
        ne(members.email, project.ownerEmail),
        cursor ? gt(members.id, cursor) : undefined,
        query
          ? or(ilike(members.name, pattern), ilike(members.email, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(members.id))
    .limit(21);
  return {
    people: rows.slice(0, 20).map(person),
    nextCursor: rows.length === 21 ? (rows[19]?.id ?? null) : null,
  };
}

export async function setPublishedAppAccess({
  projectId,
  opId,
  expectedRevision,
  change,
}: PublishedAppAccessChange): Promise<PublishedAppAccessReceipt> {
  const { current } = await sharingManager(projectId);
  const { orgId } = current;
  const actorId = current.membership.memberId;
  const fingerprint = digest([expectedRevision, change]);
  return getDb().transaction(async (tx) => {
    const projectScope = and(
      eq(projects.orgId, orgId),
      eq(projects.id, projectId),
      isNull(projects.trashedAt),
    );
    const [project] = await tx
      .select()
      .from(projects)
      .where(projectScope)
      .limit(1)
      .for("update");
    if (!project) projectNotFound();
    if (!canManageProject(await projectAccessLevel(current, project, [], tx)))
      fail(copy.denied, {
        statusCode: 403,
        errorCode: "forbidden",
      });
    const [prior] = await tx
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.orgId, orgId),
          eq(receipts.projectId, projectId),
          eq(receipts.actorId, actorId),
          eq(receipts.opId, opId),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        fail(copy.intentMismatch, {
          statusCode: 409,
          errorCode: "intent_mismatch",
        });
      return setPublishedAppAccessOutput.parse(prior.receipt);
    }
    if (String(project.appSharingRevision) !== expectedRevision)
      fail(copy.revisionConflict, {
        statusCode: 409,
        errorCode: "sharing_revision_conflict",
      });
    const appHref = await publishedHref(tx, project);
    if (!appHref)
      fail(copy.unavailable, {
        statusCode: 404,
        errorCode: "release_not_found",
      });

    const active = scopedGrants(orgId, projectId, tx);
    const committedAt = new Date().toISOString();
    let effect: PublishedAppAccessReceipt["effect"] = "no_change";
    let grant: PublishedAppGrant;
    if (change.kind === "grant") {
      const members = publishedAppMemberDirectory(orgId, tx);
      const [member] = await tx
        .select()
        .from(members)
        .where(eq(members.id, change.memberId))
        .limit(1);
      if (!member || member.email === project.ownerEmail)
        fail(copy.recipientNotMember, {
          statusCode: 422,
          errorCode: "recipient_not_member",
        });
      const [existing] = await tx
        .select()
        .from(active)
        .where(eq(active.memberId, member.id))
        .limit(1);
      if (existing) {
        grant = projectGrant(existing);
      } else {
        const id = randomUUID();
        await tx.insert(grants).values({
          id,
          orgId,
          projectId,
          memberId: member.id,
          role: change.role,
          createdBy: actorId,
          createdAt: committedAt,
        });
        grant = {
          id,
          person: person(member),
          role: change.role,
          createdAt: committedAt,
        };
        effect = "added";
      }
    } else {
      const [existing] = await tx
        .select()
        .from(active)
        .where(eq(active.id, change.grantId))
        .limit(1);
      if (!existing)
        fail(copy.grantUnavailable, {
          statusCode: 404,
          errorCode: "grant_not_found",
        });
      await tx
        .update(grants)
        .set({ revokedAt: committedAt })
        .where(
          and(
            eq(grants.orgId, orgId),
            eq(grants.projectId, projectId),
            eq(grants.id, existing.id),
            isNull(grants.revokedAt),
          ),
        );
      if (existing.email)
        await cancelRevokedViewerRuns(
          tx,
          { orgId, ownerEmail: existing.email },
          projectId,
        );
      grant = projectGrant(existing);
      effect = "removed";
    }
    const revision =
      effect === "no_change"
        ? project.appSharingRevision
        : project.appSharingRevision + 1n;
    if (effect !== "no_change")
      await tx
        .update(projects)
        .set({ appSharingRevision: revision })
        .where(projectScope);
    const receipt = {
      opId,
      revision: revisionSchema.parse(String(revision)),
      effect,
      grant,
      appHref,
      committedAt,
    };
    await tx
      .insert(receipts)
      .values({ orgId, projectId, actorId, opId, fingerprint, receipt });
    return receipt;
  });
}
