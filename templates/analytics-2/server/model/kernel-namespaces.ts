import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import {
  appSessionIdSchema,
  attemptIdSchema,
  kernelGenerationSchema,
  namespaceIdSchema,
  releaseIdSchema,
  runIdSchema,
} from "../../shared/notebook-execution.js";
import {
  absentSchema,
  decimalIntegerSchema,
  deniedSchema,
  notebookProjectIdSchema,
  pendingSchema,
  unreadableSchema,
  workspaceIdSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import type { Queryable } from "./scope.js";

const { kernelNamespaces, kernelOperations } = schema;
const key = z.string().min(1);
const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("draft"),
    projectId: notebookProjectIdSchema,
  }),
  z.strictObject({
    kind: z.literal("thread"),
    projectId: notebookProjectIdSchema,
    threadId: key,
  }),
  z.strictObject({ kind: z.literal("preview"), previewId: key }),
  z.strictObject({
    kind: z.literal("release_session"),
    releaseId: releaseIdSchema,
    sessionId: appSessionIdSchema,
  }),
]);
const controlBase = z.strictObject({
  scope: scopeSchema,
  requestId: z.uuid(),
  expectedGeneration: kernelGenerationSchema,
});
export const kernelControlInputSchema = z.discriminatedUnion("operation", [
  controlBase.extend({
    operation: z.literal("interrupt"),
    attemptId: attemptIdSchema,
  }),
  controlBase.extend({
    operation: z.enum(["stop", "restart", "restart-and-run-all"]),
  }),
]);

export const kernelControlReceiptSchema = z.strictObject({
  requestId: z.uuid(),
  generation: kernelGenerationSchema,
  state: z.enum(["stopping", "stopped", "unknown", "queued", "ready"]),
  runId: runIdSchema.optional(),
  cursor: decimalIntegerSchema,
});

const kernelRejectedSchema = z.strictObject({
  status: z.literal("rejected"),
  reason: z.enum(["kernel_generation_conflict", "kernel_intent_reused"]),
});
export const kernelUnavailableSchema = z.discriminatedUnion("status", [
  absentSchema,
  deniedSchema,
  unreadableSchema,
  pendingSchema,
]);
const kernelControlResultSchema = z.union([
  kernelControlReceiptSchema,
  kernelRejectedSchema,
  kernelUnavailableSchema,
]);

export const kernelStreamInputSchema = z.strictObject({
  runId: runIdSchema,
  after: decimalIntegerSchema.optional(),
});
export const kernelStreamResultSchema = z.union([
  z.strictObject({
    streamUrl: z.url(),
    token: key,
    expiresAt: z.iso.datetime(),
    cursor: decimalIntegerSchema,
  }),
  kernelUnavailableSchema,
]);

export type KernelControlInput = z.infer<typeof kernelControlInputSchema>;
type KernelControlReceipt = z.infer<typeof kernelControlReceiptSchema>;
type KernelControlResult = z.infer<typeof kernelControlResultSchema>;
type KernelUnavailable = z.infer<typeof kernelUnavailableSchema>;
type StreamInput = z.infer<typeof kernelStreamInputSchema>;
type NamespaceRow = typeof kernelNamespaces.$inferSelect;

export type KernelActor = {
  workspaceId: z.infer<typeof workspaceIdSchema>;
  principalId: string;
  email: string;
};

export interface NotebookKernelExecution {
  authorizeStream(
    actor: KernelActor,
    input: StreamInput,
  ): Promise<
    | KernelUnavailable
    | {
        status: "allowed";
        namespaceId: z.infer<typeof namespaceIdSchema>;
        generation: z.infer<typeof kernelGenerationSchema>;
        cursor: string;
      }
  >;
  control(
    actor: KernelActor,
    input: KernelControlInput,
  ): Promise<KernelControlResult>;
}

export type KernelHostPin = {
  hostId: string;
  serviceSha: string;
  imageDigest: string;
};

export type KernelNamespaceIdentity = Pick<
  NamespaceRow,
  "orgId" | "projectId" | "scopeKind" | "scopeId" | "principalId"
>;

export type KernelBinding = NamespaceRow & KernelHostPin;
type CurrentBinding = Pick<
  NamespaceRow,
  "id" | "orgId" | "principalId" | "generation" | "hostId"
>;
const liveStatuses = ["reserved", "ready", "busy"] as const;

function namespaceScope(scope: KernelNamespaceIdentity) {
  return and(
    eq(kernelNamespaces.orgId, scope.orgId),
    eq(kernelNamespaces.projectId, scope.projectId),
    eq(kernelNamespaces.scopeKind, scope.scopeKind),
    eq(kernelNamespaces.scopeId, scope.scopeId),
    eq(kernelNamespaces.principalId, scope.principalId),
  );
}

export async function reserveKernelNamespace(
  scope: KernelNamespaceIdentity & Pick<NamespaceRow, "id" | "lineageId">,
  host: KernelHostPin,
  at: Date,
  db: Queryable,
  generation = 1n,
): Promise<NamespaceRow> {
  const [inserted] = await db
    .insert(kernelNamespaces)
    .values({
      ...scope,
      ...host,
      generation,
      status: "reserved",
      heartbeatAt: at,
    })
    .onConflictDoNothing({
      target: [
        kernelNamespaces.orgId,
        kernelNamespaces.projectId,
        kernelNamespaces.scopeKind,
        kernelNamespaces.scopeId,
        kernelNamespaces.principalId,
      ],
    })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(kernelNamespaces)
    .where(namespaceScope(scope))
    .limit(1);
  if (!existing)
    throw new Error("Kernel namespace reservation could not be read");
  return existing;
}

export async function readKernelBinding(
  actor: KernelActor,
  namespaceId: string,
  generation: string,
  db: Queryable = getDb(),
): Promise<KernelBinding | null> {
  const [row] = await db
    .select()
    .from(kernelNamespaces)
    .where(
      and(
        eq(kernelNamespaces.id, namespaceId),
        eq(kernelNamespaces.orgId, actor.workspaceId),
        eq(kernelNamespaces.principalId, actor.principalId),
        eq(kernelNamespaces.generation, BigInt(generation)),
        inArray(kernelNamespaces.status, liveStatuses),
      ),
    )
    .limit(1);
  if (!row || !row.hostId || !row.serviceSha || !row.imageDigest) return null;
  return {
    ...row,
    hostId: row.hostId,
    serviceSha: row.serviceSha,
    imageDigest: row.imageDigest,
  };
}

export async function readKernelNamespace(
  actor: KernelActor,
  namespaceId: string,
  db: Queryable = getDb(),
  lock = false,
): Promise<NamespaceRow | undefined> {
  const query = db
    .select()
    .from(kernelNamespaces)
    .where(
      and(
        eq(kernelNamespaces.id, namespaceId),
        eq(kernelNamespaces.orgId, actor.workspaceId),
        eq(kernelNamespaces.principalId, actor.principalId),
      ),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  return row;
}

function currentGeneration(binding: CurrentBinding) {
  return and(
    eq(kernelNamespaces.id, binding.id),
    eq(kernelNamespaces.orgId, binding.orgId),
    eq(kernelNamespaces.principalId, binding.principalId),
    eq(kernelNamespaces.generation, binding.generation),
  );
}

export async function recordKernelHeartbeat(
  binding: KernelBinding,
  status: "ready" | "busy",
  at: Date,
  db: Queryable = getDb(),
): Promise<boolean> {
  const [updated] = await db
    .update(kernelNamespaces)
    .set({ status, heartbeatAt: at })
    .where(
      and(
        currentGeneration(binding),
        eq(kernelNamespaces.hostId, binding.hostId),
        inArray(kernelNamespaces.status, liveStatuses),
        lte(kernelNamespaces.heartbeatAt, at),
      ),
    )
    .returning({ id: kernelNamespaces.id });
  return updated !== undefined;
}

export async function advanceKernelGeneration(
  binding: CurrentBinding,
  next:
    | { status: "reserved"; host: KernelHostPin; lineageId: string }
    | { status: "stopped" | "expired" },
  at: Date,
  db: Queryable,
): Promise<NamespaceRow | null> {
  const pin =
    next.status === "reserved"
      ? { ...next.host, lineageId: next.lineageId }
      : { hostId: null, serviceSha: null, imageDigest: null };
  const [updated] = await db
    .update(kernelNamespaces)
    .set({
      ...pin,
      generation: binding.generation + 1n,
      status: next.status,
      heartbeatAt: at,
      variableState: null,
    })
    .where(currentGeneration(binding))
    .returning();
  return updated ?? null;
}

export async function commitKernelControl(
  actor: KernelActor,
  namespaceId: string,
  input: KernelControlInput,
  at: Date,
  db: Queryable,
  apply: (binding: NamespaceRow) => Promise<KernelControlReceipt>,
): Promise<KernelControlResult> {
  const [binding] = await db
    .select()
    .from(kernelNamespaces)
    .where(
      and(
        eq(kernelNamespaces.id, namespaceId),
        eq(kernelNamespaces.orgId, actor.workspaceId),
        eq(kernelNamespaces.principalId, actor.principalId),
      ),
    )
    .limit(1)
    .for("update");
  if (!binding) return { status: "absent", reason: "not_found" };
  const intent = JSON.stringify([
    input.operation,
    input.expectedGeneration,
    input.operation === "interrupt" ? input.attemptId : null,
  ]);
  const [existing] = await db
    .select()
    .from(kernelOperations)
    .where(
      and(
        eq(kernelOperations.namespaceId, binding.id),
        eq(kernelOperations.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.intent === intent
      ? kernelControlReceiptSchema.parse(existing.receipt)
      : { status: "rejected", reason: "kernel_intent_reused" };
  }
  if (binding.generation !== BigInt(input.expectedGeneration)) {
    return { status: "rejected", reason: "kernel_generation_conflict" };
  }
  const receipt = kernelControlReceiptSchema.parse(await apply(binding));
  await db.insert(kernelOperations).values({
    namespaceId: binding.id,
    requestId: input.requestId,
    generation: binding.generation,
    intent,
    receipt,
    createdAt: at,
  });
  return receipt;
}
