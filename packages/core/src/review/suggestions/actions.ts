import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getDbExec, type DbExec } from "../../db/client.js";
import { notifyReviewComment } from "../notifications.js";
import { assertReviewableResourceAccess } from "../registry.js";
import {
  ensureReviewTables,
  insertReviewCommentWithClient,
  resolveReviewThreadWithClient,
} from "../store.js";
import {
  suggestionActorKind,
  suggestionActorKindMatchesReceipt,
} from "./actor-kind.js";
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
  getSuggestionAmendment,
  amendSuggestion,
  deleteUnclaimedSuggestion,
  type SuggestionCreationReceipt,
  getSuggestionProposal,
  insertSuggestionProposal,
  getProposalCreation,
  recordProposalCreation,
  getProposalDecision,
  recordProposalDecision,
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

function stableJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item) ?? "null").join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([key, item]) => {
      const encoded = stableJson(item);
      return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
    })
    .join(",")}}`;
}

async function creationRequestHash(args: {
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  baseRevision: string;
  summary: string;
  operations: unknown[];
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const request = stableJson({
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    adapterKind: args.adapterKind,
    baseRevision: args.baseRevision,
    summary: args.summary,
    operations: args.operations,
    metadata: args.metadata ?? null,
  })!;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(request),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function assertCreationReplay(
  receipt: SuggestionCreationReceipt,
  requestHash: string,
  authorEmail: string | null,
  actorKind: ResourceSuggestion["actorKind"],
): ResourceSuggestion {
  const actorKindMatches = suggestionActorKindMatchesReceipt(
    receipt.actorKind,
    actorKind,
    receipt.receiptVersion,
  );
  if (
    receipt.requestHash !== requestHash ||
    receipt.authorEmail !== authorEmail ||
    !actorKindMatches
  ) {
    throw new Error(
      "Idempotency key was already used for a different suggestion",
    );
  }
  return receipt.suggestion;
}

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
    // Connected external agents arrive as mcp/webmcp/a2a callers; classifying
    // them as human would lose agent provenance on persisted suggestions.
    const actorKind = suggestionActorKind(ctx);
    const authorEmail = (ctx as any)?.userEmail ?? null;
    const requestHash = await creationRequestHash(args);
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
        return {
          suggestion: assertCreationReplay(
            prior,
            requestHash,
            authorEmail,
            actorKind,
          ),
          threadComment: null,
        };
      }
      const operations =
        (await adapter.validateProposal({
          ...args,
          ctx: {
            ...(ctx as any),
            suggestionAccess: access,
            transaction: tx,
          },
        })) ?? args.operations;
      const created = await insertSuggestion(
        {
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          adapterKind: adapter.kind,
          adapterVersion: adapter.version,
          threadId: `suggestion-thread-${globalThis.crypto.randomUUID()}`,
          authorEmail,
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
      const receipt = await recordSuggestionCreation(
        tx,
        args.idempotencyKey,
        created,
        authorEmail,
        actorKind,
        requestHash,
      );
      if (receipt.suggestion.id !== created.id) {
        await deleteUnclaimedSuggestion(tx, created.id);
        return {
          suggestion: assertCreationReplay(
            receipt,
            requestHash,
            authorEmail,
            actorKind,
          ),
          threadComment: null,
        };
      }
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

export const updateResourceSuggestion = defineAction({
  description:
    "Amend your pending suggestion while preserving its discussion and history; returns the updated suggestion and revision.",
  schema: z.object({
    id: z.string().min(1).describe("The existing pending suggestion to amend."),
    observedRevision: z
      .number()
      .int()
      .positive()
      .describe(
        "The suggestion revision you read; refresh after a conflict before editing again.",
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Reuse this key only for an exact retry of this amendment; use a new key for new edits.",
      ),
    operations: z
      .array(operation)
      .min(1)
      .describe(
        "Replacement proposal operations against the suggestion's existing canonical basis.",
      ),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Optional replacement summary; omission preserves the existing summary.",
      ),
  }),
  run: async (args, ctx) => {
    const initial = await getSuggestion(args.id);
    if (!initial)
      fail("Suggestion not found", { statusCode: 404, errorCode: "not_found" });
    await assertReviewableResourceAccess(
      initial.resourceType,
      initial.resourceId,
      ctx as any,
      "commenter",
    );
    const author = (ctx as any)?.userEmail;
    if (!author || author !== initial.authorEmail) {
      fail("Only the author can amend this suggestion", {
        statusCode: 403,
        errorCode: "forbidden",
      });
    }
    const db = getDbExec();
    if (!db.transaction)
      throw new Error(
        "Suggestion amendments require an atomic database transaction",
      );
    const request = JSON.stringify({
      id: args.id,
      observedRevision: args.observedRevision,
      operations: args.operations,
      summary: args.summary ?? null,
    });
    return db.transaction(async (tx) => {
      const current = await getSuggestion(args.id, tx);
      if (!current)
        fail("Suggestion not found", {
          statusCode: 404,
          errorCode: "not_found",
        });
      const access = await assertReviewableResourceAccess(
        current.resourceType,
        current.resourceId,
        { ...(ctx as any), transaction: tx },
        "commenter",
      );
      if (current.authorEmail !== author)
        fail("Only the author can amend this suggestion", {
          statusCode: 403,
          errorCode: "forbidden",
        });
      const prior = await getSuggestionAmendment(tx, args.idempotencyKey);
      if (prior) {
        if (prior.suggestionId !== current.id || prior.request !== request) {
          fail("Idempotency key was already used for a different amendment", {
            statusCode: 409,
            errorCode: "idempotency_conflict",
          });
        }
        return prior.suggestion;
      }
      if (
        current.status !== "pending" ||
        current.revision !== args.observedRevision
      ) {
        fail("The suggestion changed; refresh before editing", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      }
      const adapter = getSuggestionAdapter(current.adapterKind);
      if (!adapter || adapter.version !== current.adapterVersion)
        throw new Error("Suggestion adapter version is unavailable");
      const operations =
        (await adapter.validateProposal({
          resourceType: current.resourceType,
          resourceId: current.resourceId,
          baseRevision: current.baseRevision,
          operations: args.operations,
          ctx: { ...(ctx as any), transaction: tx, suggestionAccess: access },
        })) ?? args.operations;
      const updated = await amendSuggestion(
        tx,
        current,
        operations,
        args.summary ?? current.summary,
        args.idempotencyKey,
        request,
      );
      if (!updated)
        fail("The suggestion changed; refresh before editing", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      return updated;
    });
  },
  audit: {
    target: (_args, result) => {
      const suggestion = result as ResourceSuggestion;
      return {
        type: suggestion.resourceType,
        id: suggestion.resourceId,
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
    observedRevision: z.number().int().positive().optional(),
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
    const reviewer = (ctx as any)?.userEmail ?? null;
    const observedRevision = args.observedRevision ?? 1;
    const replayDecision = async (tx: DbExec) => {
      const decision = await getDecision(tx, args.idempotencyKey);
      const latest = await getSuggestion(args.id, tx);
      if (
        !decision ||
        !latest ||
        decision.suggestionId !== args.id ||
        decision.reviewer !== reviewer ||
        decision.decision !== args.decision ||
        decision.observedBase !== args.observedBase ||
        latest.revision !== observedRevision
      ) {
        fail("The suggestion changed; refresh before deciding", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      }
      return { suggestion: latest, decision };
    };
    const decide = (coordination?: unknown) =>
      db.transaction!(async (tx) => {
        const current = await getSuggestion(args.id, tx);
        if (!current) throw new Error("Suggestion not found");
        const decisionAccess = await assertReviewableResourceAccess(
          current.resourceType,
          current.resourceId,
          { ...(ctx as any), transaction: tx },
          "editor",
        );
        if (current.status !== "pending") {
          return replayDecision(tx);
        }
        const currentAdapter = getSuggestionAdapter(current.adapterKind);
        if (observedRevision !== current.revision) {
          fail("The suggestion changed; refresh before deciding", {
            statusCode: 409,
            errorCode: "suggestion_conflict",
          });
        }
        if (
          !currentAdapter ||
          currentAdapter.version !== current.adapterVersion
        )
          throw new Error("Suggestion adapter version is unavailable");
        if (current.baseRevision !== args.observedBase) {
          if (
            !(await updateSuggestionStatus(
              tx,
              current.id,
              "stale",
              current.revision,
            ))
          ) {
            return replayDecision(tx);
          }
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
          current.revision,
        );
        if (!claimed) return replayDecision(tx);
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
              access: decisionAccess,
              ctx: {
                ...(ctx as any),
                suggestionAccess: decisionAccess,
                transaction: tx,
              },
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

const proposalCreationSchema = z.object({
  ...base,
  adapterKind: z.string().min(1),
  baseRevision: z.string().min(1),
  summary: z.string().trim().min(1).max(500),
  proposalId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(200),
  suggestions: z
    .array(
      z.object({
        summary: z.string().trim().min(1).max(500),
        operations: z.array(operation).length(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

export const getResourceSuggestionProposalByCreationKey = defineAction({
  description:
    "Find an earlier proposal creation by its idempotency key before recomputing an edit.",
  schema: z.object({ idempotencyKey: z.string().min(1).max(200) }),
  readOnly: true,
  run: async (args, ctx) => {
    await ensureSuggestionTables();
    const db = getDbExec();
    const receipt = await getProposalCreation(db, args.idempotencyKey);
    if (!receipt) return null;
    const proposal = await getSuggestionProposal(db, receipt.proposalId);
    if (!proposal)
      throw new Error(
        "Proposal creation receipt references a missing proposal",
      );
    await assertReviewableResourceAccess(
      proposal.resourceType,
      proposal.resourceId,
      ctx as any,
      "viewer",
    );
    if (
      receipt.authorEmail !== ((ctx as any)?.userEmail ?? null) ||
      receipt.actorKind !== suggestionActorKind(ctx)
    ) {
      fail("The proposal creation key belongs to another caller", {
        statusCode: 403,
        errorCode: "forbidden",
      });
    }
    const suggestions = await Promise.all(
      receipt.suggestionIds.map(async (id) => {
        const suggestion = await getSuggestion(id, db);
        if (!suggestion)
          throw new Error(
            "Proposal creation receipt references a missing suggestion",
          );
        return suggestion;
      }),
    );
    return { proposal, suggestions };
  },
});

export const createResourceSuggestionProposal = defineAction({
  description:
    "Create or append independently reviewable suggestions under one durable proposal.",
  schema: proposalCreationSchema,
  run: async (args, ctx) => {
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "commenter",
    );
    const adapter = getSuggestionAdapter(args.adapterKind);
    if (!adapter) throw new Error("Suggestion adapter not registered");
    const authorEmail = (ctx as any)?.userEmail ?? null;
    const actorKind = suggestionActorKind(ctx);
    const requestHash = await creationRequestHash({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      adapterKind: args.adapterKind,
      baseRevision: args.baseRevision,
      summary: args.summary,
      operations: args.suggestions,
      metadata: { proposalId: args.proposalId ?? null },
    });
    const db = getDbExec();
    await ensureSuggestionTables();
    await ensureReviewTables();
    if (!db.transaction)
      throw new Error(
        "Proposal creation requires an atomic database transaction",
      );
    const result = await db.transaction(async (tx) => {
      const prior = await getProposalCreation(tx, args.idempotencyKey);
      if (prior) {
        if (
          prior.requestHash !== requestHash ||
          prior.authorEmail !== authorEmail ||
          prior.actorKind !== actorKind
        ) {
          fail(
            "Idempotency key was already used for a different proposal creation",
            { statusCode: 409, errorCode: "idempotency_conflict" },
          );
        }
        const proposal = await getSuggestionProposal(tx, prior.proposalId);
        if (!proposal)
          throw new Error(
            "Proposal creation receipt references a missing proposal",
          );
        const suggestions = await Promise.all(
          prior.suggestionIds.map(async (id) => {
            const suggestion = await getSuggestion(id, tx);
            if (!suggestion)
              throw new Error(
                "Proposal creation receipt references a missing suggestion",
              );
            return suggestion;
          }),
        );
        return {
          proposal,
          suggestions,
          comments: [] as Awaited<
            ReturnType<typeof insertReviewCommentWithClient>
          >[],
        };
      }
      const proposal = args.proposalId
        ? await getSuggestionProposal(tx, args.proposalId)
        : await insertSuggestionProposal(tx, {
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            adapterKind: args.adapterKind,
            summary: args.summary,
            authorEmail,
            actorKind,
          });
      if (!proposal)
        fail("Proposal not found", { statusCode: 404, errorCode: "not_found" });
      if (
        proposal.resourceType !== args.resourceType ||
        proposal.resourceId !== args.resourceId ||
        proposal.adapterKind !== args.adapterKind ||
        proposal.authorEmail !== authorEmail ||
        proposal.actorKind !== actorKind ||
        proposal.summary !== args.summary
      ) {
        fail("Proposal does not match this request", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      }
      const comments: Awaited<
        ReturnType<typeof insertReviewCommentWithClient>
      >[] = [];
      const suggestions: ResourceSuggestion[] = [];
      for (const item of args.suggestions) {
        const operations =
          (await adapter.validateProposal({
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            baseRevision: args.baseRevision,
            operations: item.operations,
            metadata: item.metadata,
            ctx: { ...(ctx as any), suggestionAccess: access, transaction: tx },
          })) ?? item.operations;
        const created = await insertSuggestion(
          {
            proposalId: proposal.id,
            proposalSummary: proposal.summary,
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            adapterKind: adapter.kind,
            adapterVersion: adapter.version,
            threadId: `suggestion-thread-${globalThis.crypto.randomUUID()}`,
            authorEmail,
            actorKind,
            baseRevision: args.baseRevision,
            status: "pending",
            summary: item.summary,
            ownerEmail: access.ownerEmail ?? null,
            orgId: access.orgId ?? null,
            visibility: access.visibility ?? "private",
            metadata: item.metadata ?? null,
            operations,
          },
          tx,
        );
        suggestions.push(created);
        comments.push(
          await insertReviewCommentWithClient(
            {
              resourceType: created.resourceType,
              resourceId: created.resourceId,
              threadId: created.threadId,
              targetId: created.id,
              kind: "correction",
              anchor: created.operations.map((part) => part.anchor ?? null),
              body: created.summary,
              authorEmail,
              createdBy: actorKind,
              resolutionTarget: "human",
              ownerEmail: created.ownerEmail,
              orgId: created.orgId,
              visibility: created.visibility,
              metadata: { suggestionId: created.id, proposalId: proposal.id },
            },
            tx,
          ),
        );
      }
      await recordProposalCreation(
        tx,
        args.idempotencyKey,
        proposal.id,
        authorEmail,
        actorKind,
        requestHash,
        suggestions.map((suggestion) => suggestion.id),
      );
      return { proposal, suggestions, comments };
    });
    for (const comment of result.comments) await notifyReviewComment(comment);
    return { proposal: result.proposal, suggestions: result.suggestions };
  },
  audit: {
    target: (_args, result) => {
      const suggestion = (result as { suggestions: ResourceSuggestion[] })
        .suggestions[0];
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

export const decideResourceSuggestionProposal = defineAction({
  description:
    "Accept or reject an exact observed set of proposal members in one transaction.",
  schema: z.object({
    proposalId: z.string().min(1),
    decision: z.enum(["accepted", "rejected"]),
    idempotencyKey: z.string().min(1).max(200),
    members: z
      .array(
        z.object({
          id: z.string().min(1),
          observedRevision: z.number().int().positive(),
          observedBase: z.string().min(1),
        }),
      )
      .min(1),
  }),
  run: async (args, ctx) => {
    await ensureSuggestionTables();
    const db = getDbExec();
    if (!db.transaction)
      throw new Error(
        "Proposal decisions require an atomic database transaction",
      );
    const proposal = await getSuggestionProposal(db, args.proposalId);
    if (!proposal)
      fail("Proposal not found", { statusCode: 404, errorCode: "not_found" });
    const access = await assertReviewableResourceAccess(
      proposal.resourceType,
      proposal.resourceId,
      ctx as any,
      "editor",
    );
    const members = args.members;
    if (new Set(members.map((member) => member.id)).size !== members.length) {
      fail("A proposal member was listed twice", {
        statusCode: 409,
        errorCode: "suggestion_conflict",
      });
    }
    const reviewer = (ctx as any)?.userEmail ?? null;
    const request = stableJson({
      proposalId: args.proposalId,
      decision: args.decision,
      members,
    })!;
    const initial = await getSuggestion(members[0]!.id, db);
    if (!initial || initial.proposalId !== proposal.id) {
      fail("A proposal member is unavailable", {
        statusCode: 409,
        errorCode: "suggestion_conflict",
      });
    }
    const adapter = getSuggestionAdapter(proposal.adapterKind);
    if (!adapter) throw new Error("Suggestion adapter not registered");
    const decide = (coordination?: unknown) =>
      db.transaction!(async (tx) => {
        const currentProposal = await getSuggestionProposal(
          tx,
          args.proposalId,
        );
        if (!currentProposal)
          fail("Proposal not found", {
            statusCode: 404,
            errorCode: "not_found",
          });
        await assertReviewableResourceAccess(
          proposal.resourceType,
          proposal.resourceId,
          { ...(ctx as any), transaction: tx },
          "editor",
        );
        const prior = await getProposalDecision(tx, args.idempotencyKey);
        if (prior) {
          if (
            prior.proposalId !== proposal.id ||
            prior.reviewer !== reviewer ||
            prior.decision !== args.decision ||
            prior.request !== request
          ) {
            fail(
              "Idempotency key was already used for a different proposal decision",
              { statusCode: 409, errorCode: "idempotency_conflict" },
            );
          }
          const suggestions = await Promise.all(
            prior.suggestionIds.map((id) => getSuggestion(id, tx)),
          );
          if (suggestions.some((suggestion) => !suggestion))
            throw new Error(
              "Proposal decision receipt references a missing suggestion",
            );
          return {
            proposal: currentProposal,
            suggestions: suggestions as ResourceSuggestion[],
          };
        }
        const suggestions: ResourceSuggestion[] = [];
        for (const observed of members) {
          const current = await getSuggestion(observed.id, tx);
          if (
            !current ||
            current.proposalId !== proposal.id ||
            current.resourceType !== proposal.resourceType ||
            current.resourceId !== proposal.resourceId ||
            current.adapterKind !== proposal.adapterKind ||
            current.adapterVersion !== adapter.version ||
            current.status !== "pending" ||
            current.revision !== observed.observedRevision ||
            current.baseRevision !== observed.observedBase
          ) {
            fail("A proposal member changed; refresh before deciding", {
              statusCode: 409,
              errorCode: "suggestion_conflict",
            });
          }
          suggestions.push(current);
        }
        for (const suggestion of suggestions) {
          const updated = await updateSuggestionStatus(
            tx,
            suggestion.id,
            args.decision,
            suggestion.revision,
          );
          if (!updated)
            fail("A proposal member changed; refresh before deciding", {
              statusCode: 409,
              errorCode: "suggestion_conflict",
            });
          if (args.decision === "accepted") {
            try {
              await adapter.apply({
                resourceType: suggestion.resourceType,
                resourceId: suggestion.resourceId,
                suggestion,
                operations: suggestion.operations,
                access,
                ctx: {
                  ...(ctx as any),
                  suggestionAccess: access,
                  transaction: tx,
                },
                transaction: tx,
                coordination,
              });
            } catch (error) {
              if (
                error instanceof Error &&
                error.name === "SuggestionStaleError"
              ) {
                fail(
                  "A proposal member is stale; no proposal edits were applied",
                  { statusCode: 409, errorCode: "suggestion_conflict" },
                );
              }
              throw error;
            }
          }
          await resolveReviewThreadWithClient(
            tx,
            suggestion.threadId,
            reviewer,
            {
              resourceType: suggestion.resourceType,
              resourceId: suggestion.resourceId,
            },
            args.decision,
          );
        }
        if (args.decision === "accepted") {
          await adapter.finalizeProposalDecision?.({
            resourceType: proposal.resourceType,
            resourceId: proposal.resourceId,
            transaction: tx,
            coordination,
          });
        }
        await recordProposalDecision(
          tx,
          args.idempotencyKey,
          proposal.id,
          reviewer,
          args.decision,
          request,
          suggestions.map((suggestion) => suggestion.id),
        );
        return {
          proposal: currentProposal,
          suggestions: await Promise.all(
            suggestions.map(async (suggestion) => {
              const latest = await getSuggestion(suggestion.id, tx);
              if (!latest) throw new Error("Decided suggestion disappeared");
              return latest;
            }),
          ),
        };
      });
    if (args.decision === "accepted" && adapter.coordinateDecision) {
      return adapter.coordinateDecision(
        {
          resourceType: proposal.resourceType,
          resourceId: proposal.resourceId,
          suggestion: initial,
          operations: initial.operations,
          decision: args.decision,
          proposalDecision: true,
          access,
          ctx: { ...(ctx as any), suggestionAccess: access },
        },
        decide,
      );
    }
    return decide();
  },
  audit: {
    target: (_args, result) => {
      const suggestion = (result as { suggestions: ResourceSuggestion[] })
        .suggestions[0];
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
