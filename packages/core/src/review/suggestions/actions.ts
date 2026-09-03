import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { notifyReviewComment } from "../notifications.js";
import { assertReviewableResourceAccess } from "../registry.js";
import {
  ensureReviewTables,
  insertReviewCommentWithClient,
  resolveReviewThreadWithClient,
} from "../store.js";
import { getSuggestionAdapter } from "./registry.js";
import {
  getSuggestion,
  ensureSuggestionTables,
  insertSuggestion,
  listSuggestions,
  recordDecision,
  getDecision,
  getSuggestionByCreationKey,
  recordSuggestionCreation,
  replaceSuggestionStatus,
  updateSuggestionStatus,
} from "./store.js";
import type { ResourceSuggestion } from "./types.js";

const base = { resourceType: z.string().min(1), resourceId: z.string().min(1) };
const operation = z.object({
  ordinal: z.number().int().nonnegative(),
  kind: z.string().min(1),
  targetId: z.string().nullable().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  anchor: z.unknown().optional(),
  dependencies: z.unknown().optional(),
  schemaVersion: z.number().int().positive(),
});

export const createResourceSuggestion = defineAction({
  description:
    "Create a typed pending suggestion without changing the canonical resource.",
  schema: z.object({
    ...base,
    adapterKind: z.string().min(1),
    baseRevision: z.string().min(1),
    summary: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().min(1).max(200),
    operations: z.array(operation).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  link: ({ args, result }) => {
    const suggestion = result as ResourceSuggestion;
    const url = getSuggestionAdapter(args.adapterKind)?.buildUrl?.(
      args.resourceId,
      suggestion.id,
    );
    return url ? { url, label: "Open suggestion" } : null;
  },
  run: async (args, ctx) => {
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "commenter",
    );
    const adapter = getSuggestionAdapter(args.adapterKind);
    if (!adapter) throw new Error("Suggestion adapter not registered");
    const adapterContext = { ...(ctx as any), suggestionAccess: access };
    const operations =
      (await adapter.validateProposal({ ...args, ctx: adapterContext })) ??
      args.operations;
    const actorKind =
      (ctx as any)?.caller === "agent" || (ctx as any)?.caller === "tool"
        ? "agent"
        : (ctx as any)?.userEmail
          ? "human"
          : "system";
    const db = getDbExec();
    await ensureSuggestionTables();
    await ensureReviewTables();
    if (!db.transaction)
      throw new Error(
        "Suggestion creation requires an atomic database transaction",
      );
    const result = await db.transaction(async (tx) => {
      const prior = await getSuggestionByCreationKey(tx, args.idempotencyKey);
      if (prior) {
        if (
          prior.resourceType !== args.resourceType ||
          prior.resourceId !== args.resourceId ||
          prior.adapterKind !== args.adapterKind ||
          prior.baseRevision !== args.baseRevision
        ) {
          throw new Error(
            "Idempotency key was already used for a different suggestion",
          );
        }
        return { suggestion: prior, threadComment: null };
      }
      const created = await insertSuggestion(
        {
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          adapterKind: adapter.kind,
          adapterVersion: adapter.version,
          threadId: `suggestion-thread-${globalThis.crypto.randomUUID()}`,
          authorEmail: (ctx as any)?.userEmail ?? null,
          actorKind,
          baseRevision: args.baseRevision,
          status: "pending",
          summary: args.summary,
          ownerEmail: access.ownerEmail ?? null,
          orgId: access.orgId ?? null,
          visibility: access.visibility ?? "private",
          metadata: args.metadata ?? null,
          operations,
        },
        tx,
      );
      await recordSuggestionCreation(tx, args.idempotencyKey, created.id);
      const threadComment = await insertReviewCommentWithClient(
        {
          resourceType: created.resourceType,
          resourceId: created.resourceId,
          threadId: created.threadId,
          targetId: created.id,
          kind: "correction",
          anchor: created.operations.map((item) => item.anchor ?? null),
          body: created.summary,
          authorEmail: created.authorEmail,
          createdBy: actorKind,
          resolutionTarget: "human",
          ownerEmail: created.ownerEmail,
          orgId: created.orgId,
          visibility: created.visibility,
          metadata: { suggestionId: created.id },
        },
        tx,
      );
      return { suggestion: created, threadComment };
    });
    if (result.threadComment) await notifyReviewComment(result.threadComment);
    return result.suggestion;
  },
  audit: {
    target: (args, result) => {
      const suggestion = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: suggestion.ownerEmail,
        orgId: suggestion.orgId,
        visibility: suggestion.visibility,
      };
    },
  },
});

export const listResourceSuggestions = defineAction({
  description: "List typed suggestions for a resource.",
  schema: z.object({
    ...base,
    statuses: z
      .array(z.enum(["pending", "accepted", "rejected", "stale", "superseded"]))
      .optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "viewer",
    );
    return {
      suggestions: await listSuggestions(
        args.resourceType,
        args.resourceId,
        args.statuses,
      ),
    };
  },
});
export const getResourceSuggestion = defineAction({
  description: "Get one typed suggestion and its operations.",
  schema: z.object({ id: z.string().min(1) }),
  readOnly: true,
  link: ({ result }) => {
    const suggestion = result as ResourceSuggestion | null;
    if (!suggestion) return null;
    const url = getSuggestionAdapter(suggestion.adapterKind)?.buildUrl?.(
      suggestion.resourceId,
      suggestion.id,
    );
    return url ? { url, label: "Open suggestion" } : null;
  },
  run: async (args, ctx) => {
    const suggestion = await getSuggestion(args.id);
    if (!suggestion) throw new Error("Suggestion not found");
    await assertReviewableResourceAccess(
      suggestion.resourceType,
      suggestion.resourceId,
      ctx as any,
      "viewer",
    );
    return suggestion;
  },
});

export const decideResourceSuggestion = defineAction({
  description: "Accept or reject a pending suggestion atomically.",
  schema: z.object({
    id: z.string().min(1),
    decision: z.enum(["accepted", "rejected"]),
    idempotencyKey: z.string().min(1),
    observedBase: z.string().min(1),
  }),
  run: async (args, ctx) => {
    const suggestion = await getSuggestion(args.id);
    if (!suggestion) throw new Error("Suggestion not found");
    const access = await assertReviewableResourceAccess(
      suggestion.resourceType,
      suggestion.resourceId,
      ctx as any,
      "editor",
    );
    const db = getDbExec();
    if (!db.transaction)
      throw new Error(
        "Suggestion decisions require an atomic database transaction",
      );
    const adapter = getSuggestionAdapter(suggestion.adapterKind);
    if (!adapter || adapter.version !== suggestion.adapterVersion)
      throw new Error("Suggestion adapter version is unavailable");
    const decide = (coordination?: unknown) =>
      db.transaction!(async (tx) => {
        const current = await getSuggestion(args.id, tx);
        if (!current) throw new Error("Suggestion not found");
        if (current.status !== "pending") {
          const decision = await getDecision(tx, args.idempotencyKey);
          if (
            !decision ||
            decision.suggestionId !== current.id ||
            decision.decision !== args.decision
          ) {
            throw new Error(`Suggestion is already ${current.status}`);
          }
          return { suggestion: current, decision };
        }
        const currentAdapter = getSuggestionAdapter(current.adapterKind);
        if (
          !currentAdapter ||
          currentAdapter.version !== current.adapterVersion
        )
          throw new Error("Suggestion adapter version is unavailable");
        if (current.baseRevision !== args.observedBase) {
          if (!(await updateSuggestionStatus(tx, current.id, "stale")))
            return {
              suggestion: current,
              decision: await getDecision(tx, args.idempotencyKey),
            };
          const decision = await recordDecision(tx, {
            suggestionId: current.id,
            idempotencyKey: args.idempotencyKey,
            reviewer: (ctx as any)?.userEmail ?? null,
            decision: args.decision,
            observedBase: args.observedBase,
            outcome: "stale",
            detail: "Base revision changed",
          });
          return {
            suggestion: await getSuggestion(current.id, tx),
            decision: decision.record,
          };
        }
        const claimed = await updateSuggestionStatus(
          tx,
          current.id,
          args.decision,
        );
        if (!claimed)
          throw new Error(
            "Suggestion was decided concurrently; retry to inspect it",
          );
        const prior = await recordDecision(tx, {
          suggestionId: current.id,
          idempotencyKey: args.idempotencyKey,
          reviewer: (ctx as any)?.userEmail ?? null,
          decision: args.decision,
          observedBase: args.observedBase,
          outcome: args.decision,
          detail: null,
        });
        if (!prior.duplicate && args.decision === "accepted") {
          try {
            await currentAdapter.apply({
              resourceType: current.resourceType,
              resourceId: current.resourceId,
              suggestion: current,
              operations: current.operations,
              access,
              ctx: { ...(ctx as any), suggestionAccess: access },
              transaction: tx,
              coordination,
            });
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.name !== "SuggestionStaleError"
            ) {
              throw error;
            }
            await replaceSuggestionStatus(tx, current.id, "accepted", "stale");
            await tx.execute({
              sql: "UPDATE agent_review_suggestion_decisions SET outcome = ?, detail = ? WHERE id = ?",
              args: ["stale", error.message, prior.record.id],
            });
            return {
              suggestion: await getSuggestion(current.id, tx),
              decision: {
                ...prior.record,
                outcome: "stale",
                detail: error.message,
              },
            };
          }
        }
        if (!prior.duplicate) {
          await resolveReviewThreadWithClient(
            tx,
            current.threadId,
            (ctx as any)?.userEmail ?? null,
            {
              resourceType: current.resourceType,
              resourceId: current.resourceId,
            },
            args.decision,
          );
        }
        return {
          suggestion: await getSuggestion(current.id, tx),
          decision: prior.record,
        };
      });
    const decisionContext = {
      resourceType: suggestion.resourceType,
      resourceId: suggestion.resourceId,
      suggestion,
      operations: suggestion.operations,
      decision: args.decision,
      access,
      ctx: { ...(ctx as any), suggestionAccess: access },
    };
    return adapter.coordinateDecision
      ? adapter.coordinateDecision(decisionContext, decide)
      : decide();
  },
  audit: {
    target: (_args, result) => {
      const suggestion = (result as { suggestion?: ResourceSuggestion })
        .suggestion;
      return suggestion
        ? {
            type: suggestion.resourceType,
            id: suggestion.resourceId,
            ownerEmail: suggestion.ownerEmail,
            orgId: suggestion.orgId,
            visibility: suggestion.visibility,
          }
        : undefined;
    },
  },
});
