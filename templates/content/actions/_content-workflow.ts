import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestContext,
  getRequestRunContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  createWorkflowEventValues,
  emitWorkflowWake,
  workflowEvents,
  workflowSequenceCounters,
} from "@agent-native/core/workflow";
import { eq, sql, type SQL } from "drizzle-orm";

import { nanoid } from "./_property-utils.js";

export function contentWorkflowFingerprint(value: string | null | undefined) {
  return createHash("sha256")
    .update(value ?? "")
    .digest("hex")
    .slice(0, 24);
}

interface WorkflowTransaction {
  insert(table: typeof workflowEvents): {
    values: (value: typeof workflowEvents.$inferInsert) => Promise<unknown>;
  };
  insert(table: typeof workflowSequenceCounters): {
    values: (value: typeof workflowSequenceCounters.$inferInsert) => {
      onConflictDoNothing: () => Promise<unknown>;
    };
  };
  update(table: typeof workflowSequenceCounters): {
    set: (value: { value: SQL }) => {
      where: (condition: SQL<unknown> | undefined) => {
        returning: (selection: {
          value: typeof workflowSequenceCounters.value;
        }) => PromiseLike<Array<{ value: number }>>;
      };
    };
  };
}

export async function allocateContentWorkflowEventSequence(
  tx: WorkflowTransaction,
): Promise<number> {
  await tx
    .insert(workflowSequenceCounters)
    .values({ name: "events", value: 0 })
    .onConflictDoNothing();
  const [row] = await tx
    .update(workflowSequenceCounters)
    .set({ value: sql`${workflowSequenceCounters.value} + 1` })
    .where(eq(workflowSequenceCounters.name, "events"))
    .returning({ value: workflowSequenceCounters.value });
  if (!row || !Number.isSafeInteger(row.value) || row.value < 1) {
    throw new Error("Content workflow event sequence allocation failed");
  }
  return row.value;
}

export interface ContentWorkflowActorSnapshot extends Record<string, unknown> {
  initiator: {
    kind: "human" | "system";
    id: string;
  };
  executor: {
    kind:
      | "human"
      | "agent"
      | "api_client"
      | "provider"
      | "automation"
      | "system";
    id: string;
    model?: string;
    engine?: string;
  };
  origin: {
    kind: "ui" | "agent" | "integration" | "api" | "cli" | "system";
    platform?: string;
    sourceId?: string;
    protocol?: string;
    threadId?: string;
  };
  lineage: {
    integrationTaskId?: string;
    parentTaskId?: string;
    runId?: string;
    networkId?: string;
    parentExecutionId?: string;
    parentSubscriptionId?: string;
    chainDepth?: number;
    subscriptionPath?: string[];
  };
  authority: {
    ownerEmail: string;
  };
}

export interface ContentWorkflowCausality {
  causalEventId: string;
  parentExecutionId: string;
  parentSubscriptionId: string;
  chainDepth: number;
  subscriptionPath: string[];
  initiator?: ContentWorkflowActorSnapshot["initiator"];
}

const contentWorkflowCausality =
  new AsyncLocalStorage<ContentWorkflowCausality>();

export function runWithContentWorkflowCausality<T>(
  causality: ContentWorkflowCausality,
  task: () => T,
): T {
  return contentWorkflowCausality.run(causality, task);
}

export function contentWorkflowActorSnapshot(
  fallbackOwnerEmail: string,
  actionContext?: ActionRunContext,
  overrides: Partial<ContentWorkflowActorSnapshot> = {},
): ContentWorkflowActorSnapshot {
  const request = getRequestContext();
  const run = getRequestRunContext();
  const integration = request?.integration;
  const humanId =
    actionContext?.userEmail ?? getRequestUserEmail() ?? run?.owner;
  const isAgent = Boolean(
    run?.model ||
    run?.threadId ||
    actionContext?.caller === "tool" ||
    actionContext?.caller === "mcp" ||
    actionContext?.caller === "a2a",
  );
  const isIntegration = Boolean(integration);
  const snapshot: ContentWorkflowActorSnapshot = {
    initiator: {
      kind: humanId ? "human" : "system",
      id: humanId || "system",
    },
    executor: isAgent
      ? {
          kind: "agent",
          id:
            run?.threadId ??
            actionContext?.threadId ??
            actionContext?.caller ??
            "agent",
          ...(run?.model ? { model: run.model } : {}),
          ...(run?.engine?.name ? { engine: run.engine.name } : {}),
        }
      : isIntegration
        ? {
            kind: "provider",
            id: integration?.incoming.platform ?? "integration",
          }
        : actionContext?.caller === "http"
          ? { kind: "api_client", id: humanId || "api" }
          : {
              kind: humanId ? "human" : "system",
              id: humanId || "system",
            },
    origin: isIntegration
      ? {
          kind: "integration",
          platform: integration?.incoming.platform,
          sourceId: integration?.lineage?.source?.id,
          protocol: integration?.lineage?.network?.protocol,
          threadId: run?.threadId,
        }
      : actionContext?.caller === "mcp" || actionContext?.caller === "a2a"
        ? { kind: "api", protocol: actionContext.caller }
        : isAgent
          ? { kind: "agent", threadId: run?.threadId }
          : actionContext?.caller === "cli"
            ? { kind: "cli" }
            : actionContext?.caller === "http"
              ? { kind: "api" }
              : request || actionContext?.caller === "frontend"
                ? { kind: "ui" }
                : { kind: "system" },
    lineage: {
      integrationTaskId: integration?.taskId,
      parentTaskId: integration?.lineage?.parentTaskId,
      runId: integration?.lineage?.runId,
      networkId: integration?.lineage?.network?.id,
    },
    authority: { ownerEmail: fallbackOwnerEmail },
  };
  return {
    ...snapshot,
    ...overrides,
    initiator: { ...snapshot.initiator, ...overrides.initiator },
    executor: { ...snapshot.executor, ...overrides.executor },
    origin: { ...snapshot.origin, ...overrides.origin },
    lineage: { ...snapshot.lineage, ...overrides.lineage },
    authority: { ...snapshot.authority, ...overrides.authority },
  };
}

export async function appendContentWorkflowEvent(
  tx: WorkflowTransaction,
  input: {
    topic: `content.${string}`;
    subjectType: string;
    subjectId: string;
    databaseId?: string;
    documentId?: string;
    ownerEmail: string;
    orgId?: string | null;
    payload: Record<string, unknown>;
    occurredAt: string | number;
    actionContext?: ActionRunContext;
    actorOverrides?: Partial<ContentWorkflowActorSnapshot>;
    causalEventId?: string | null;
  },
): Promise<string> {
  const causality = contentWorkflowCausality.getStore();
  const causalActorOverrides: Partial<ContentWorkflowActorSnapshot> = causality
    ? {
        ...(causality.initiator ? { initiator: causality.initiator } : {}),
        executor: {
          kind: "automation",
          id: `content-hook:${causality.parentSubscriptionId}`,
        },
        origin: { kind: "system" },
        lineage: {
          parentExecutionId: causality.parentExecutionId,
          parentSubscriptionId: causality.parentSubscriptionId,
          chainDepth: causality.chainDepth,
          subscriptionPath: causality.subscriptionPath,
        },
      }
    : {};
  const id = nanoid();
  const eventSequence = await allocateContentWorkflowEventSequence(tx);
  await tx.insert(workflowEvents).values(
    createWorkflowEventValues({
      id,
      eventSequence,
      topic: input.topic,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId ?? null,
      payload: {
        ...(input.databaseId ? { databaseId: input.databaseId } : {}),
        ...(input.documentId ? { documentId: input.documentId } : {}),
        ...input.payload,
      },
      actorContext: contentWorkflowActorSnapshot(
        input.ownerEmail,
        input.actionContext,
        {
          ...causalActorOverrides,
          ...input.actorOverrides,
          lineage: {
            ...causalActorOverrides.lineage,
            ...input.actorOverrides?.lineage,
          },
        },
      ),
      causalEventId: input.causalEventId ?? causality?.causalEventId,
      occurredAt:
        typeof input.occurredAt === "number"
          ? input.occurredAt
          : Date.parse(input.occurredAt),
    }),
  );
  return id;
}

export function wakeContentWorkflowEvent(eventId: string): void {
  emitWorkflowWake({ topic: "workflow.event.available", rowId: eventId });
}
