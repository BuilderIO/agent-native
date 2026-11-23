import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getDbExec, sql } from "@agent-native/core/db";
import { orgMembers } from "@agent-native/core/org";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { askLifecycleErrors as copy } from "../../app/i18n/messages/ask-lifecycle-errors.js";
import {
  threadAccessReceipt,
  type listThreadAccessInput,
  type saveThreadProjectInput,
  type searchThreadMembersInput,
  type setThreadAccessInput,
} from "../../shared/analytics-thread.js";
import { getDb } from "../db/index.js";
import {
  analyticsThreadBootstraps as bootstraps,
  analyticsThreadGrants as grants,
  analyticsThreadReceipts as operations,
} from "../db/schema.js";
import {
  intentFingerprint,
  intentMismatch,
  requireOwnedAnalyticsThread,
  threadHref,
} from "./analytics-thread-bootstrap.js";
import { lockThreadBootstrap } from "./analytics-thread-turns.js";
import { listNotebookProject } from "./notebook-operations/store.js";
import type { NotebookThreadScope } from "./thread-projects.js";

export async function setAnalyticsThreadAccess(
  scope: NotebookThreadScope,
  input: z.infer<typeof setThreadAccessInput>,
) {
  const { binding } = await requireOwnedAnalyticsThread(scope, input.threadId);
  const key = and(
    eq(operations.bindingId, binding.id),
    eq(operations.opId, input.opId),
  );
  const fingerprint = intentFingerprint(input);
  return getDb().transaction(async (tx) => {
    const bootstrap = await lockThreadBootstrap(tx, binding.id);
    const [prior] = await tx.select().from(operations).where(key).limit(1);
    if (prior) {
      if (prior.fingerprint !== fingerprint) intentMismatch();
      return threadAccessReceipt.parse(prior.receipt);
    }
    if (bootstrap.revision !== BigInt(input.expectedRevision))
      fail(copy.shareChanged, {
        statusCode: 409,
        errorCode: "thread_revision_conflict",
      });
    const { change } = input;
    let grantId: string;
    let effect: "added" | "removed" | "no_change" = "no_change";
    if (change.kind === "grant") {
      const [member] = await tx
        .select()
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, scope.orgId),
            eq(orgMembers.id, change.memberId),
            isNull(orgMembers.federationRemovalPendingAt),
          ),
        )
        .limit(1)
        .for("share");
      if (!member || member.email === scope.ownerEmail) {
        fail(copy.recipientInvalid, {
          statusCode: 422,
          errorCode: "recipient_not_member",
        });
      }
      const [existing] = await tx
        .select({ id: grants.id })
        .from(grants)
        .where(
          and(
            eq(grants.bindingId, binding.id),
            eq(grants.memberId, change.memberId),
          ),
        )
        .limit(1);
      grantId = existing?.id ?? randomUUID();
      if (!existing) {
        await tx
          .insert(grants)
          .values({ id: grantId, bindingId: binding.id, memberId: member.id });
        effect = "added";
      }
    } else {
      grantId = change.grantId;
      const removed = await tx
        .delete(grants)
        .where(and(eq(grants.bindingId, binding.id), eq(grants.id, grantId)))
        .returning({ id: grants.id });
      if (removed.length) effect = "removed";
    }
    const revision = bootstrap.revision + (effect === "no_change" ? 0n : 1n);
    if (revision !== bootstrap.revision)
      await tx
        .update(bootstraps)
        .set({ revision })
        .where(eq(bootstraps.bindingId, binding.id));
    const receipt = threadAccessReceipt.parse({
      opId: input.opId,
      grantId,
      revision: revision.toString(),
      effect,
      href: threadHref(input.threadId),
    });
    await tx.insert(operations).values({
      bindingId: binding.id,
      opId: input.opId,
      fingerprint,
      receipt,
    });
    return receipt;
  });
}

export async function listAnalyticsThreadAccess(
  scope: NotebookThreadScope,
  input: z.infer<typeof listThreadAccessInput>,
) {
  const { binding, bootstrap } = await requireOwnedAnalyticsThread(
    scope,
    input.threadId,
  );
  const rows = await getDb()
    .select({
      id: grants.id,
      memberId: grants.memberId,
      email: orgMembers.email,
    })
    .from(grants)
    .innerJoin(orgMembers, eq(orgMembers.id, grants.memberId))
    .where(
      and(
        eq(grants.bindingId, binding.id),
        eq(orgMembers.orgId, scope.orgId),
        isNull(orgMembers.federationRemovalPendingAt),
        ...(input.cursor ? [gt(grants.id, input.cursor)] : []),
      ),
    )
    .orderBy(asc(grants.id))
    .limit(51);
  const page = rows.slice(0, 50);
  const profiles = await getUserProfiles(page.map(({ email }) => email));
  return {
    grants: page.map(({ id, memberId, email }) => ({
      id,
      memberId,
      displayName: profiles.get(email)?.name ?? email,
      role: "thread_viewer" as const,
    })),
    revision: bootstrap.revision.toString(),
    next: rows.length > 50 ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function searchAnalyticsThreadMembers(
  scope: NotebookThreadScope,
  input: z.infer<typeof searchThreadMembersInput>,
) {
  await requireOwnedAnalyticsThread(scope, input.threadId);
  const search = input.search.toLowerCase();
  const { rows } = await getDbExec().execute(sql`
    SELECT m.id, m.email, u.name FROM org_members m LEFT JOIN "user" u ON lower(u.email) = lower(m.email)
    WHERE m.org_id = ${sql.value(scope.orgId)} AND m.federation_removal_pending_at IS NULL AND m.email <> ${sql.value(scope.ownerEmail)}
      AND (strpos(lower(m.email), ${sql.value(search)}) > 0 OR strpos(lower(u.name), ${sql.value(search)}) > 0)
    ORDER BY m.email LIMIT 25
  `);
  const members = z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable(),
      }),
    )
    .parse(rows);
  const profiles = await getUserProfiles(members.map(({ email }) => email));
  return {
    members: members.map(({ id, email, name }) => {
      const profileName = profiles.get(email.toLowerCase())?.name;
      const displayName =
        profileName && profileName.toLowerCase() !== email.toLowerCase()
          ? profileName
          : name?.trim() || email;
      return { id, email, displayName };
    }),
  };
}

export async function saveAnalyticsThreadProject(
  scope: NotebookThreadScope,
  input: z.infer<typeof saveThreadProjectInput>,
) {
  const { project } = await requireOwnedAnalyticsThread(scope, input.threadId);
  const operation = await listNotebookProject(
    scope,
    project.id,
    input.opId,
    input.expectedHead,
  );
  return {
    opId: input.opId,
    projectId: project.id,
    listed: true as const,
    href: `/project/${encodeURIComponent(project.id)}`,
    operation,
  };
}
