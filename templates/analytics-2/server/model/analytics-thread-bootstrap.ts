import { createHash, randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import { and, eq, isNull } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";
import {
  createThread,
  getThread,
  isAgentChatAiSetupReady,
} from "@agent-native/core/server";

import { askLifecycleErrors as copy } from "../../app/i18n/messages/ask-lifecycle-errors.js";
import { workspaceChatScope } from "../../app/lib/workspace-chat-scope.js";
import {
  startThreadReceipt,
  type StartThreadInput,
} from "../../shared/analytics-thread.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsThreadBootstraps as bootstraps,
  analyticsThreadGrants as grants,
  analyticsThreadTurns as turns,
} from "../db/schema.js";
import { phase1AskFixture } from "../lib/phase1-ask-fixture.js";
import { requireProjectCreationAccess } from "../lib/project-creation-access.js";
import { workspaceAccess } from "../lib/workspace-access.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { createNotebook } from "./notebook-creation/store.js";
import { notebookThreadProjects as bindings } from "./notebook-proposal-schema.js";
import type { Queryable } from "./scope.js";
import type { NotebookThreadScope } from "./thread-projects.js";

export type ThreadBootstrap = typeof bootstraps.$inferSelect;
export type AnalyticsThreadBinding = typeof bindings.$inferSelect;

export function threadNotFound(): never {
  return fail(copy.denied, { statusCode: 404, errorCode: "thread_not_found" });
}

export function threadForbidden(): never {
  return fail(copy.denied, { statusCode: 403, errorCode: "thread_forbidden" });
}

export function intentMismatch(): never {
  return fail(copy.sendFailed, {
    statusCode: 409,
    errorCode: "intent_mismatch",
  });
}

export function admissionUnreadable(): never {
  return fail(copy.sendFailed, {
    statusCode: 503,
    errorCode: "admission_unreadable",
  });
}

export async function checkedThreadAdmission<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (isActionContractError(error)) throw error;
    console.error("[analytics-2] Ask admission failed", error);
    return admissionUnreadable();
  }
}

export async function requireAskProvider(prompt: string) {
  if (
    phase1AskFixture()?.modelUnavailable(prompt) ||
    !(await isAgentChatAiSetupReady())
  )
    fail(copy.providerUnavailable, {
      statusCode: 503,
      errorCode: "ai_provider_unavailable",
    });
}

export const intentFingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export const threadHref = (threadId: string) =>
  `/thread/${encodeURIComponent(threadId)}`;

function identity(scope: NotebookThreadScope) {
  return and(
    eq(bootstraps.orgId, scope.orgId),
    eq(bootstraps.appId, scope.appId),
    eq(bootstraps.ownerId, scope.ownerEmail),
  );
}

export async function readBootstrap(
  scope: NotebookThreadScope,
  intentId: string,
) {
  await ensureAnalyticsDatabase();
  const [row] = await getDb()
    .select()
    .from(bootstraps)
    .where(and(identity(scope), eq(bootstraps.intentId, intentId)))
    .limit(1);
  return row;
}

export async function readAnalyticsThreadBinding(
  scope: NotebookThreadScope,
  threadId: string,
  db: Queryable = getDb(),
) {
  const [row] = await db
    .select({
      bootstrap: bootstraps,
      binding: bindings,
      project: schema.projects,
    })
    .from(bootstraps)
    .innerJoin(bindings, eq(bindings.id, bootstraps.bindingId))
    .innerJoin(schema.projects, eq(schema.projects.id, bindings.projectId))
    .where(
      and(
        eq(bootstraps.orgId, scope.orgId),
        eq(bootstraps.appId, scope.appId),
        eq(bootstraps.threadId, threadId),
        eq(bindings.orgId, scope.orgId),
        eq(bindings.appId, scope.appId),
        eq(bindings.threadId, threadId),
        isNull(bindings.endedAt),
        eq(schema.projects.orgId, scope.orgId),
        eq(schema.projects.ownerEmail, bootstraps.ownerId),
        isNull(schema.projects.trashedAt),
      ),
    )
    .limit(1);
  return row;
}

export type BoundAnalyticsThread = NonNullable<
  Awaited<ReturnType<typeof readAnalyticsThreadBinding>>
>;

export async function readAnalyticsThreadAccess(
  scope: NotebookThreadScope,
  threadId: string,
  db: Queryable = getDb(),
) {
  const bound = await readAnalyticsThreadBinding(scope, threadId, db);
  if (!bound) {
    const [intent] = await db
      .select({ id: bootstraps.bindingId })
      .from(bootstraps)
      .where(
        and(
          eq(bootstraps.orgId, scope.orgId),
          eq(bootstraps.appId, scope.appId),
          eq(bootstraps.threadId, threadId),
        ),
      )
      .limit(1);
    if (intent) threadNotFound();
    return null;
  }
  const owner = bound.bootstrap.ownerId === scope.ownerEmail;
  if (!owner) {
    const [grant] = await db
      .select({ id: grants.id })
      .from(grants)
      .innerJoin(orgMembers, eq(orgMembers.id, grants.memberId))
      .where(
        and(
          eq(grants.bindingId, bound.binding.id),
          eq(orgMembers.orgId, scope.orgId),
          eq(orgMembers.email, scope.ownerEmail),
          isNull(orgMembers.federationRemovalPendingAt),
        ),
      )
      .limit(1);
    if (!grant) threadNotFound();
  }
  const thread = await getThread(threadId);
  const expectedScope = workspaceChatScope(scope.orgId, scope.appId);
  if (
    !thread ||
    thread.orgId !== scope.orgId ||
    thread.ownerEmail !== bound.bootstrap.ownerId ||
    thread.source?.appId !== scope.appId ||
    thread.scope?.type !== expectedScope.type ||
    thread.scope.id !== expectedScope.id
  )
    threadNotFound();
  return { ...bound, thread, owner };
}

export async function requireOwnedAnalyticsThread(
  scope: NotebookThreadScope,
  threadId: string,
) {
  await ensureAnalyticsDatabase();
  const access = await readAnalyticsThreadAccess(scope, threadId);
  if (!access) threadNotFound();
  if (!access.owner) threadForbidden();
  return access;
}

export function analyticsThreadRef(binding: AnalyticsThreadBinding) {
  return {
    threadId: binding.threadId,
    projectId: binding.projectId,
    bindingId: binding.id,
    workingVersionId: binding.workingVersionId,
    href: threadHref(binding.threadId),
  };
}

export async function readStartReceipt(
  row: ThreadBootstrap,
  db: Queryable = getDb(),
) {
  if (row.phase === "binding")
    return { phase: "binding" as const, intentId: row.intentId };
  const [binding] = await db
    .select()
    .from(bindings)
    .where(and(eq(bindings.id, row.bindingId), isNull(bindings.endedAt)))
    .limit(1);
  if (!binding) return admissionUnreadable();
  const [turn] =
    row.initialMessageId === null
      ? []
      : await db
          .select({ receipt: turns.receipt })
          .from(turns)
          .where(
            and(
              eq(turns.bindingId, row.bindingId),
              eq(turns.messageId, row.initialMessageId),
            ),
          )
          .limit(1);
  if (row.phase === "submitted" && !turn?.receipt) return admissionUnreadable();
  return startThreadReceipt.parse({
    ...analyticsThreadRef(binding),
    phase: row.phase,
    initialTurn: turn?.receipt ?? null,
    uploadSlots: row.uploads.map(({ uploadId, clientFileId, state }) => ({
      uploadId,
      clientFileId,
      state,
    })),
  });
}

export async function provisionAnalyticsThread(
  scope: NotebookThreadScope,
  input: StartThreadInput,
) {
  await ensureAnalyticsDatabase();
  const db = getDb();
  const fingerprint = intentFingerprint(input);
  const read = () => readBootstrap(scope, input.intentId);
  const authorize = async () => {
    await workspaceAccess.assertPermission(["create-thread"], {
      userEmail: scope.ownerEmail,
      orgId: scope.orgId,
    });
    if (input.mode !== "ask") await requireProjectCreationAccess();
  };
  await authorize();
  let row = await read();
  if (row && row.fingerprint !== fingerprint) intentMismatch();
  if (!row) {
    await db
      .insert(bootstraps)
      .values({
        orgId: scope.orgId,
        appId: scope.appId,
        ownerId: scope.ownerEmail,
        intentId: input.intentId,
        fingerprint,
        projectId: `prj_${randomUUID()}`,
        threadId: randomUUID(),
        bindingId: randomUUID(),
        mode: input.mode,
        phase: "binding",
        initialMessageId:
          input.trigger.kind === "submit" ? input.intentId : null,
        initialPrompt:
          input.trigger.kind === "submit" ? input.trigger.prompt : null,
        uploads:
          input.trigger.kind === "attach"
            ? input.trigger.uploads.map((file) => ({
                ...file,
                uploadId: randomUUID(),
                state: "pending" as const,
              }))
            : [],
        updatedAt: nowIso(),
      })
      .onConflictDoNothing();
    row = await read();
    if (!row) return admissionUnreadable();
    if (row.fingerprint !== fingerprint) intentMismatch();
  }
  if (row.phase !== "binding") return row;

  const project = await createNotebook(
    { ...scope, requestId: row.bindingId },
    {
      starter: { kind: "empty" },
      projectId: row.projectId,
      listed: row.mode !== "ask",
      ...(row.mode === "ask" ? { title: copy.newThread } : {}),
    },
    async () => ({ cells: [], recheck: authorize }),
    authorize,
  );
  const coreScope = workspaceChatScope(scope.orgId, scope.appId);
  let thread = await getThread(row.threadId);
  if (!thread) {
    try {
      thread = await createThread(scope.ownerEmail, {
        id: row.threadId,
        orgId: scope.orgId,
        scope: coreScope,
        source: { appId: scope.appId },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      thread = await getThread(row.threadId);
    }
  }
  if (
    !thread ||
    thread.orgId !== scope.orgId ||
    thread.ownerEmail !== scope.ownerEmail ||
    thread.source?.appId !== scope.appId ||
    thread.scope?.type !== coreScope.type ||
    thread.scope.id !== coreScope.id
  )
    return admissionUnreadable();
  const reserved = row;
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(bootstraps)
      .where(eq(bootstraps.bindingId, reserved.bindingId))
      .limit(1)
      .for("update");
    if (!locked) admissionUnreadable();
    if (locked.phase !== "binding") return;
    await tx.insert(bindings).values({
      id: locked.bindingId,
      threadId: locked.threadId,
      kind: locked.mode,
      orgId: scope.orgId,
      appId: scope.appId,
      projectId: project.projectId,
      workingVersionId: project.workingVersionId,
      createdBy: scope.ownerEmail,
      createdAt: nowIso(),
    });
    await tx
      .update(bootstraps)
      .set({
        phase: locked.uploads.length ? "awaiting_upload" : "ready",
        updatedAt: nowIso(),
      })
      .where(eq(bootstraps.bindingId, locked.bindingId));
  });
  const final = await read();
  return final ?? admissionUnreadable();
}

export async function workspaceChatThreadPermitsSharing(threadId: string) {
  await ensureAnalyticsDatabase();
  const [row] = await getDb()
    .select({ id: bootstraps.bindingId })
    .from(bootstraps)
    .where(eq(bootstraps.threadId, threadId))
    .limit(1);
  return row === undefined;
}
