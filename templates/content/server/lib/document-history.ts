import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq, sql } from "drizzle-orm";

import type {
  DocumentHistoryActorKind,
  DocumentHistoryGroupKind,
} from "../../shared/document-history.js";
import { getDb, schema } from "../db/index.js";
import {
  documentVersionChatContextFromAction,
  serializeDocumentVersionChatContext,
} from "./document-version-context.js";

type ContentDb = ReturnType<typeof getDb>;

export interface DocumentHistoryState {
  title: string;
  content: string;
}

export interface DocumentHistoryCause {
  ctx?: ActionRunContext;
  historySessionId?: string;
  groupId?: string;
  groupKind?: Exclude<DocumentHistoryGroupKind, "legacy">;
  actorEmail?: string | null;
  actorKind?: Exclude<DocumentHistoryActorKind, "unknown">;
  origin?: string;
  operation: string;
}

interface ResolvedDocumentHistoryCause {
  groupId: string;
  groupKind: Exclude<DocumentHistoryGroupKind, "legacy">;
  actorEmail: string | null;
  actorKind: Exclude<DocumentHistoryActorKind, "unknown">;
  origin: string;
  operation: string;
}

function newGroupId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function resolveDocumentHistoryCause(
  cause: DocumentHistoryCause,
): ResolvedDocumentHistoryCause {
  const ctx = cause.ctx;
  if (cause.groupId && cause.groupKind) {
    return {
      groupId: cause.groupId,
      groupKind: cause.groupKind,
      actorEmail: cause.actorEmail ?? ctx?.userEmail ?? null,
      actorKind: cause.actorKind ?? "system",
      origin: cause.origin ?? ctx?.caller ?? "internal",
      operation: cause.operation,
    };
  }
  if (
    ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "a2a"
  ) {
    const causalId = ctx.runId ?? ctx.turnId;
    const actorEmail = cause.actorEmail ?? ctx.userEmail ?? null;
    return {
      groupId: causalId
        ? `agent:${actorEmail ?? "unknown"}:${causalId}`
        : newGroupId("agent"),
      groupKind: "agent_run",
      actorEmail,
      actorKind: "agent",
      origin: cause.origin ?? ctx.caller,
      operation: cause.operation,
    };
  }
  if (cause.historySessionId) {
    const actorEmail = cause.actorEmail ?? ctx?.userEmail ?? null;
    return {
      groupId: `human:${actorEmail ?? "unknown"}:${cause.historySessionId}`,
      groupKind: "human_session",
      actorEmail,
      actorKind: "human",
      origin: cause.origin ?? ctx?.caller ?? "frontend",
      operation: cause.operation,
    };
  }
  if (ctx?.caller === "automation") {
    const causalId = ctx.automation?.triggerId;
    return {
      groupId: causalId
        ? `automation:${causalId}:${ctx.runId ?? crypto.randomUUID()}`
        : newGroupId("automation"),
      groupKind: "operation",
      actorEmail: cause.actorEmail ?? ctx.userEmail ?? null,
      actorKind: "automation",
      origin: cause.origin ?? "automation",
      operation: cause.operation,
    };
  }
  return {
    groupId: newGroupId("operation"),
    groupKind: "operation",
    actorEmail: cause.actorEmail ?? ctx?.userEmail ?? null,
    actorKind:
      cause.actorKind ?? (ctx?.caller === "frontend" ? "human" : "system"),
    origin: cause.origin ?? ctx?.caller ?? "internal",
    operation: cause.operation,
  };
}

export async function recordDocumentHistoryTransition(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  before: DocumentHistoryState;
  after: DocumentHistoryState;
  cause: DocumentHistoryCause;
  now: string;
}): Promise<{
  groupId: string;
  beforeCheckpointId?: string;
  afterCheckpointId: string;
}> {
  const cause = resolveDocumentHistoryCause(args.cause);
  const [latest] = await args.db
    .select({
      id: schema.documentVersions.id,
      title: schema.documentVersions.title,
      content: schema.documentVersions.content,
      createdAt: schema.documentVersions.createdAt,
    })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, args.ownerEmail),
        eq(schema.documentVersions.documentId, args.documentId),
      ),
    )
    .orderBy(
      desc(schema.documentVersions.createdAt),
      sql`case when ${schema.documentVersions.checkpointKind} = 'after' then 0 else 1 end`,
      desc(schema.documentVersions.id),
    )
    .limit(1);
  const latestMs = latest ? new Date(latest.createdAt).getTime() : 0;
  const requestedMs = new Date(args.now).getTime();
  const checkpointCreatedAt = new Date(
    Math.max(requestedMs, latestMs + 1),
  ).toISOString();

  let beforeCheckpointId: string | undefined;
  if (
    !latest ||
    latest.title !== args.before.title ||
    latest.content !== args.before.content
  ) {
    beforeCheckpointId = crypto.randomUUID();
    await args.db.insert(schema.documentVersions).values({
      id: beforeCheckpointId,
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      title: args.before.title,
      content: args.before.content,
      chatContext: serializeDocumentVersionChatContext(
        documentVersionChatContextFromAction(args.cause.ctx),
      ),
      ...cause,
      checkpointKind: "before",
      createdAt: checkpointCreatedAt,
      updatedAt: checkpointCreatedAt,
    });
  }

  const afterCreatedAt = beforeCheckpointId
    ? new Date(new Date(checkpointCreatedAt).getTime() + 1).toISOString()
    : checkpointCreatedAt;
  const afterCheckpointId = crypto.randomUUID();
  await args.db.insert(schema.documentVersions).values({
    id: afterCheckpointId,
    ownerEmail: args.ownerEmail,
    documentId: args.documentId,
    title: args.after.title,
    content: args.after.content,
    chatContext: serializeDocumentVersionChatContext(
      documentVersionChatContextFromAction(args.cause.ctx),
    ),
    ...cause,
    checkpointKind: "after",
    createdAt: afterCreatedAt,
    updatedAt: afterCreatedAt,
  });
  return { groupId: cause.groupId, beforeCheckpointId, afterCheckpointId };
}
