import { createHash, randomUUID } from "node:crypto";

import {
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { getDbExec, isUniqueViolation } from "@agent-native/core/db";
import { and, desc, eq, isNull } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";
import { createThread, getThread } from "@agent-native/core/server";
import {
  resolveAccess,
  resolveAccessMany,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { z } from "zod";

import { notebookProposalErrors as copy } from "../../app/i18n/messages/notebook-proposal-errors.js";
import { workspaceChatScope } from "../../app/lib/workspace-chat-scope.js";
import {
  type bindNotebookThreadSchema,
  type createNotebookThreadSchema,
  type NotebookThreadInput,
  notebookThreadBindingSchema,
} from "../../shared/notebook-proposals.js";
import { getDb } from "../db/index.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  lockNotebookProject,
  snapshotRef,
} from "./notebook-operations/store.js";
import { notebookThreadProjects } from "./notebook-proposal-schema.js";
import type { Queryable, WorkspaceScope } from "./scope.js";

export type NotebookThreadScope = WorkspaceScope & { appId: string };
export type NotebookThreadBinding = typeof notebookThreadProjects.$inferSelect;

export async function currentNotebookThreadScope(context?: ActionRunContext) {
  const { orgId, ownerEmail } = await requireCurrentWorkspace();
  return { orgId, ownerEmail, appId: currentApplicationId(context) };
}

function threadNotFound(): never {
  return fail(copy.threadNotFound, {
    statusCode: 404,
    errorCode: "thread_not_found",
  });
}

export function reviewContextRequired(withoutThread = false): never {
  return fail(
    withoutThread
      ? copy.reviewContextRequiredWithoutThread
      : copy.reviewContextRequired,
    { statusCode: 403, errorCode: "review_context_required" },
  );
}

function reviewForbidden(): never {
  return fail(copy.reviewForbidden, {
    statusCode: 403,
    errorCode: "review_forbidden",
  });
}

function bindingScope(scope: NotebookThreadScope) {
  return and(
    eq(notebookThreadProjects.orgId, scope.orgId),
    eq(notebookThreadProjects.appId, scope.appId),
    eq(notebookThreadProjects.kind, "notebook"),
    isNull(notebookThreadProjects.endedAt),
  );
}

const coreThreadSummary = z.strictObject({ id: z.string(), title: z.string() });

async function coreThread(scope: NotebookThreadScope, threadId: string) {
  const workspace = workspaceChatScope(scope.orgId, scope.appId);
  const result = await getDbExec().execute({
    sql: "SELECT id, title FROM chat_threads WHERE id = ? AND org_id = ? AND scope_type = ? AND scope_id = ? LIMIT 1",
    args: [threadId, scope.orgId, workspace.type, workspace.id],
  });
  const row = result.rows[0];
  return row === undefined ? null : coreThreadSummary.parse(row);
}

async function assertMembership(scope: NotebookThreadScope, tx: Queryable) {
  const [member] = await tx
    .select({ email: orgMembers.email })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, scope.orgId),
        eq(orgMembers.email, scope.ownerEmail),
        isNull(orgMembers.federationRemovalPendingAt),
      ),
    )
    .limit(1);
  if (!member) reviewForbidden();
}

async function assertCoreThread(
  scope: NotebookThreadScope,
  threadId: string,
  tx: Queryable,
) {
  await assertMembership(scope, tx);
  const access = await resolveAccess(
    "chat_thread",
    threadId,
    {
      userEmail: scope.ownerEmail,
      orgId: scope.orgId,
      transaction: getDbExec(),
    },
    { skipResourceBody: true },
  );
  if (
    !access ||
    access.resource.orgId !== scope.orgId ||
    !(await coreThread(scope, threadId))
  )
    threadNotFound();
  if (!roleSatisfies(access.role, "editor")) reviewForbidden();
}

export async function requireNotebookThreadBinding(
  scope: NotebookThreadScope,
  input: NotebookThreadInput,
  tx: Queryable = getDb(),
  mode: "share" | "update" = "share",
) {
  const project = await lockNotebookProject(
    scope,
    input.projectId,
    tx,
    "share",
  );
  await assertCoreThread(scope, input.threadId, tx);
  const [binding] = await tx
    .select()
    .from(notebookThreadProjects)
    .where(
      and(
        bindingScope(scope),
        eq(notebookThreadProjects.threadId, input.threadId),
        eq(notebookThreadProjects.projectId, project.id),
        eq(notebookThreadProjects.workingVersionId, project.workingVersionId),
      ),
    )
    .limit(1)
    .for(mode);
  if (!binding || project.notebookVersionId !== project.workingVersionId)
    reviewContextRequired();
  return binding;
}

function bindingView(binding: NotebookThreadBinding) {
  return notebookThreadBindingSchema.parse({
    bindingId: binding.id,
    projectId: binding.projectId,
    threadId: binding.threadId,
    workingVersionId: binding.workingVersionId,
    overlayRevision: binding.overlayRevision.toString(),
  });
}

export async function bindNotebookThread(
  scope: NotebookThreadScope,
  input: z.infer<typeof bindNotebookThreadSchema>,
) {
  await ensureAnalyticsDatabase();
  const db = getDb();
  return db.transaction(async (tx) => {
    const project = await lockNotebookProject(
      scope,
      input.projectId,
      tx,
      "update",
    );
    await assertCoreThread(scope, input.threadId, tx);
    const [existing] = await tx
      .select()
      .from(notebookThreadProjects)
      .where(
        and(
          bindingScope(scope),
          eq(notebookThreadProjects.threadId, input.threadId),
        ),
      )
      .limit(1)
      .for("update");
    if (existing && existing.projectId !== project.id) reviewForbidden();
    const current = snapshotRef(scope, project).head;
    if (existing?.workingVersionId === project.workingVersionId)
      return bindingView(existing);
    if (
      existing !== undefined ||
      project.notebookVersionId !== project.workingVersionId ||
      current.versionId !== input.head.versionId ||
      current.revision !== input.head.revision
    ) {
      fail(copy.baseChanged, {
        statusCode: 409,
        errorCode: "proposal_base_changed",
        details: { acceptedHead: current },
      });
    }
    const [binding] = await tx
      .insert(notebookThreadProjects)
      .values({
        id: randomUUID(),
        orgId: scope.orgId,
        appId: scope.appId,
        threadId: input.threadId,
        projectId: project.id,
        workingVersionId: project.workingVersionId,
        kind: "notebook",
        createdBy: scope.ownerEmail,
        createdAt: nowIso(),
      })
      .onConflictDoNothing()
      .returning();
    if (!binding) reviewForbidden();
    return bindingView(binding);
  });
}

/**
 * A chat thread that was not opened from the notebook (for example the shell
 * agent) has no binding yet. When one of its tool runs proposes a change to a
 * notebook the person owns, bind that thread to the notebook at its accepted
 * head so the change is staged for review instead of being refused. A thread
 * already bound to another notebook is never moved.
 */
export async function ensureToolNotebookThreadBinding(
  scope: NotebookThreadScope,
  input: NotebookThreadInput,
) {
  await ensureAnalyticsDatabase();
  const head = await getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(
      scope,
      input.projectId,
      tx,
      "share",
    );
    const [existing] = await tx
      .select({
        projectId: notebookThreadProjects.projectId,
        workingVersionId: notebookThreadProjects.workingVersionId,
      })
      .from(notebookThreadProjects)
      .where(
        and(
          bindingScope(scope),
          eq(notebookThreadProjects.threadId, input.threadId),
        ),
      )
      .limit(1);
    if (existing && existing.projectId !== project.id) return null;
    if (existing?.workingVersionId === project.workingVersionId) return null;
    return snapshotRef(scope, project).head;
  });
  if (head === null) return;
  try {
    await bindNotebookThread(scope, {
      ...input,
      opId: randomUUID(),
      head,
    });
  } catch (error) {
    // A concurrent bind of the same thread is fine; the proposal path reads it.
    if (!isActionContractError(error) || error.statusCode !== 403) throw error;
  }
}

export async function createNotebookThread(
  scope: NotebookThreadScope,
  input: z.infer<typeof createNotebookThreadSchema>,
) {
  await ensureAnalyticsDatabase();
  await getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(
      scope,
      input.projectId,
      tx,
      "share",
    );
    const current = snapshotRef(scope, project).head;
    if (
      project.notebookVersionId !== project.workingVersionId ||
      current.versionId !== input.head.versionId
    ) {
      fail(copy.baseChanged, {
        statusCode: 409,
        errorCode: "proposal_base_changed",
        details: { acceptedHead: current },
      });
    }
  });
  const threadId =
    input.threadId ??
    createHash("sha256")
      .update(
        JSON.stringify([
          scope.orgId,
          scope.appId,
          scope.ownerEmail,
          input.projectId,
          input.opId,
        ]),
      )
      .digest("hex");
  if (!(await getThread(threadId))) {
    try {
      await createThread(scope.ownerEmail, {
        id: threadId,
        orgId: scope.orgId,
        scope: workspaceChatScope(scope.orgId, scope.appId),
        source: { appId: scope.appId },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return bindNotebookThread(scope, { ...input, threadId });
}

export async function listNotebookThreads(
  scope: NotebookThreadScope,
  projectId: string,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "share");
    const candidates = await tx
      .select({ id: notebookThreadProjects.threadId })
      .from(notebookThreadProjects)
      .where(
        and(
          bindingScope(scope),
          eq(notebookThreadProjects.projectId, projectId),
          eq(notebookThreadProjects.workingVersionId, project.workingVersionId),
        ),
      )
      .orderBy(
        desc(notebookThreadProjects.createdAt),
        notebookThreadProjects.threadId,
      )
      .limit(200);
    const allowed = await resolveAccessMany(
      "chat_thread",
      candidates.map(({ id }) => id),
      {
        userEmail: scope.ownerEmail,
        orgId: scope.orgId,
        transaction: getDbExec(),
      },
      { skipResourceBody: true },
    );
    const threads = [];
    for (const { id } of candidates) {
      const access = allowed.get(id);
      if (!access || !roleSatisfies(access.role, "editor")) continue;
      const thread = await coreThread(scope, id);
      if (thread) threads.push(thread);
    }
    return { threads };
  });
}
