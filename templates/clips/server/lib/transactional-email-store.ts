import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

const timestampSchema = z.string().datetime({ offset: true });
const nonEmptyStringSchema = z.string().trim().min(1);
export const transactionalEmailRecipientSchema = z.string().email();
const recipientSchema = transactionalEmailRecipientSchema;
const recordingIdSchema = nonEmptyStringSchema;

export const transactionalEmailStateSchema = z.enum([
  "pending",
  "awaiting_ai",
  "ai_dispatched",
  "ready",
  "sending",
  "sent",
  "cancelled",
  "failed",
]);

export const recapMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The three recap modules the agent writes; everything else is templated. */
export const recapCopySchema = z
  .object({
    heroLine: nonEmptyStringSchema.max(400),
    agentBreakdown: nonEmptyStringSchema.max(400),
    completionNote: nonEmptyStringSchema.max(400),
  })
  .strict();

const commonPayloadFields = {
  recipient: recipientSchema,
  shareId: nonEmptyStringSchema.optional(),
  requestedBy: nonEmptyStringSchema.optional(),
};

export const transactionalEmailPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("first-view"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("unviewed-reminder"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("first-import"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("first-agent-view"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("monthly-recap"),
      ...commonPayloadFields,
      // The month's top clip, which anchors the card and the AI copy.
      recordingIds: z.array(recordingIdSchema).length(1),
      month: recapMonthSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("two-clips"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(2),
    })
    .strict(),
]);

const reconciliationCursorSchema = z
  .object({
    createdAt: timestampSchema,
    id: nonEmptyStringSchema,
  })
  .strict()
  .nullable()
  .optional();

export const transactionalEmailConfigSchema = z
  .object({
    enabledAt: timestampSchema,
    reconciliationCursor: reconciliationCursorSchema,
    shareDiscoveryCursor: reconciliationCursorSchema,
    reminderCursor: reconciliationCursorSchema,
    firstViewCursor: reconciliationCursorSchema,
    firstAgentViewCursor: reconciliationCursorSchema,
    firstImportCursor: reconciliationCursorSchema,
  })
  .strict();

export const transactionalEmailCursorNameSchema = z.enum([
  "shareDiscoveryCursor",
  "reminderCursor",
  "firstViewCursor",
  "firstAgentViewCursor",
  "firstImportCursor",
]);

export const transactionalEmailJobSchema = z
  .object({
    logicalKey: nonEmptyStringSchema,
    type: z.enum([
      "first-view",
      "unviewed-reminder",
      "first-agent-view",
      "first-import",
      "monthly-recap",
      "two-clips",
    ]),
    state: transactionalEmailStateSchema,
    recipient: recipientSchema,
    recordingIds: z.array(recordingIdSchema).min(1),
    shareId: nonEmptyStringSchema.optional(),
    requestedBy: nonEmptyStringSchema.optional(),
    month: recapMonthSchema.optional(),
    generatedSummary: z.string().max(20_000).optional(),
    attempts: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    aiDispatchedAt: timestampSchema.optional(),
    aiClaimedBy: recipientSchema.optional(),
    readyAt: timestampSchema.optional(),
    sendingAt: timestampSchema.optional(),
    sentAt: timestampSchema.optional(),
    cancelledAt: timestampSchema.optional(),
    failedAt: timestampSchema.optional(),
    lastError: z.string().max(4_000).nullable(),
    leaseUntil: timestampSchema.nullable(),
    leaseToken: nonEmptyStringSchema.nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    const parsedPayload = transactionalEmailPayloadSchema.safeParse({
      type: job.type,
      recipient: job.recipient,
      recordingIds: job.recordingIds,
      shareId: job.shareId,
      requestedBy: job.requestedBy,
      ...(job.month === undefined ? {} : { month: job.month }),
    });
    if (!parsedPayload.success) {
      context.addIssue({
        code: "custom",
        message: "Job payload does not match its transactional email type",
      });
    }
    if (
      job.state === "sending" &&
      (job.leaseUntil === null || job.leaseToken === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Sending jobs require leaseUntil and leaseToken",
        path: job.leaseUntil === null ? ["leaseUntil"] : ["leaseToken"],
      });
    }
    if (
      job.state !== "sending" &&
      (job.leaseUntil !== null || job.leaseToken !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only sending jobs may have leaseUntil and leaseToken",
        path: job.leaseUntil !== null ? ["leaseUntil"] : ["leaseToken"],
      });
    }
  });

export type TransactionalEmailState = z.infer<
  typeof transactionalEmailStateSchema
>;
export type TransactionalEmailPayload = z.infer<
  typeof transactionalEmailPayloadSchema
>;
export type TransactionalEmailConfig = z.infer<
  typeof transactionalEmailConfigSchema
>;
export type TransactionalEmailJob = z.infer<typeof transactionalEmailJobSchema>;
export type RecapCopy = z.infer<typeof recapCopySchema>;

/** Job types whose copy is written by the agent before they can be sent. */
export function isAiBackedType(type: TransactionalEmailJob["type"]): boolean {
  return type === "two-clips";
}

export type TransactionalEmailStoreOptions = {
  now?: () => Date;
};
export const AI_DISPATCH_STALE_MS = 30 * 60 * 1000;

const allowedTransitions: Record<
  TransactionalEmailState,
  ReadonlySet<TransactionalEmailState>
> = {
  pending: new Set(["awaiting_ai", "ready", "cancelled", "failed"]),
  awaiting_ai: new Set(["ai_dispatched", "cancelled", "failed"]),
  ai_dispatched: new Set(["ready", "cancelled", "failed"]),
  ready: new Set(["sending", "cancelled", "failed"]),
  sending: new Set(["ready", "sent", "cancelled", "failed"]),
  sent: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

function stateTimestampField(
  state: TransactionalEmailState,
): keyof TransactionalEmailJob | null {
  if (state === "ai_dispatched") return "aiDispatchedAt";
  if (state === "ready") return "readyAt";
  if (state === "sending") return "sendingAt";
  if (state === "sent") return "sentAt";
  if (state === "cancelled") return "cancelledAt";
  if (state === "failed") return "failedAt";
  return null;
}

function databaseJobToJob(
  row: typeof schema.transactionalEmailJobs.$inferSelect,
): TransactionalEmailJob {
  let recordingIds: unknown;
  try {
    recordingIds = JSON.parse(row.recordingIdsJson);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(
      `Invalid transactional email job recording ids for ${row.logicalKey}${detail}`,
    );
  }
  return transactionalEmailJobSchema.parse({
    logicalKey: row.logicalKey,
    type: row.type,
    state: row.state,
    recipient: row.recipient,
    recordingIds,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastError: row.lastError,
    leaseUntil: row.leaseUntil,
    leaseToken: row.leaseToken,
    shareId: row.shareId ?? undefined,
    requestedBy: row.requestedBy ?? undefined,
    month: row.month ?? undefined,
    generatedSummary: row.generatedSummary ?? undefined,
    aiDispatchedAt: row.aiDispatchedAt ?? undefined,
    aiClaimedBy: row.aiClaimedBy ?? undefined,
    readyAt: row.readyAt ?? undefined,
    sendingAt: row.sendingAt ?? undefined,
    sentAt: row.sentAt ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    failedAt: row.failedAt ?? undefined,
  });
}

function jobToDatabaseValues(job: TransactionalEmailJob) {
  return {
    logicalKey: job.logicalKey,
    type: job.type,
    state: job.state,
    recipient: job.recipient,
    recordingIdsJson: JSON.stringify(job.recordingIds),
    shareId: job.shareId ?? null,
    requestedBy: job.requestedBy ?? null,
    month: job.month ?? null,
    generatedSummary: job.generatedSummary ?? null,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    aiDispatchedAt: job.aiDispatchedAt ?? null,
    aiClaimedBy: job.aiClaimedBy ?? null,
    readyAt: job.readyAt ?? null,
    sendingAt: job.sendingAt ?? null,
    sentAt: job.sentAt ?? null,
    cancelledAt: job.cancelledAt ?? null,
    failedAt: job.failedAt ?? null,
    lastError: job.lastError,
    leaseUntil: job.leaseUntil,
    leaseToken: job.leaseToken,
  };
}

export function createTransactionalEmailStore(
  options: TransactionalEmailStoreOptions = {},
) {
  const now = options.now ?? (() => new Date());

  function normalizeRecipient(email: string) {
    return recipientSchema.parse(email.trim().toLowerCase());
  }

  function transitionedJob(
    job: TransactionalEmailJob,
    nextState: TransactionalEmailState,
    changes: { generatedSummary?: string; lastError?: string | null } = {},
  ) {
    const timestamp = now().toISOString();
    const timestampField = stateTimestampField(nextState);
    return transactionalEmailJobSchema.parse({
      ...job,
      ...changes,
      state: nextState,
      updatedAt: timestamp,
      leaseUntil: null,
      leaseToken: null,
      ...(timestampField ? { [timestampField]: timestamp } : {}),
    });
  }

  async function readJob(
    logicalKey: string,
  ): Promise<TransactionalEmailJob | null> {
    const [row] = await getDb()
      .select()
      .from(schema.transactionalEmailJobs)
      .where(
        eq(
          schema.transactionalEmailJobs.logicalKey,
          nonEmptyStringSchema.parse(logicalKey),
        ),
      )
      .limit(1);
    return row ? databaseJobToJob(row) : null;
  }

  async function listJobs(): Promise<TransactionalEmailJob[]> {
    return (
      await getDb()
        .select()
        .from(schema.transactionalEmailJobs)
        .orderBy(asc(schema.transactionalEmailJobs.createdAt))
    ).map(databaseJobToJob);
  }

  async function replaceJob(
    job: TransactionalEmailJob,
    condition: SQL | undefined,
  ) {
    const [updated] = await getDb()
      .update(schema.transactionalEmailJobs)
      .set(jobToDatabaseValues(job))
      .where(condition)
      .returning();
    return updated ? databaseJobToJob(updated) : null;
  }

  async function enqueue(
    logicalKey: string,
    payload: TransactionalEmailPayload,
    initialState: "pending" | "awaiting_ai" = "pending",
  ) {
    const parsedKey = nonEmptyStringSchema.parse(logicalKey);
    const parsedPayload = transactionalEmailPayloadSchema.parse(payload);
    const timestamp = now().toISOString();
    const job = transactionalEmailJobSchema.parse({
      logicalKey: parsedKey,
      ...parsedPayload,
      state: initialState,
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: null,
      leaseUntil: null,
      leaseToken: null,
    });
    const [created] = await getDb()
      .insert(schema.transactionalEmailJobs)
      .values(jobToDatabaseValues(job))
      .onConflictDoNothing()
      .returning({ logicalKey: schema.transactionalEmailJobs.logicalKey });
    if (created) return { created: true, job };
    const existing = await readJob(parsedKey);
    if (!existing) {
      throw new Error(`Transactional email job disappeared for ${parsedKey}`);
    }
    return { created: false, job: existing };
  }

  async function enqueueOrConvergeFirstImport(
    recipient: string,
    recordingId: string,
    requestedBy: string,
  ) {
    const logicalKey = `first-import:${recipient.trim().toLowerCase()}`;
    const enqueued = await enqueue(logicalKey, {
      type: "first-import",
      recipient,
      recordingIds: [recordingId],
      requestedBy,
    });
    if (enqueued.created || enqueued.job.state === "sent") return enqueued;
    const job = enqueued.job;
    if (
      job.type !== "first-import" ||
      !["pending", "ready", "cancelled"].includes(job.state) ||
      job.recordingIds[0] === recordingId
    ) {
      return enqueued;
    }
    const timestamp = now().toISOString();
    const candidate = transactionalEmailJobSchema.parse({
      ...job,
      recipient,
      recordingIds: [recordingId],
      requestedBy,
      state: "pending",
      attempts: 0,
      updatedAt: timestamp,
      readyAt: undefined,
      sendingAt: undefined,
      cancelledAt: undefined,
      failedAt: undefined,
      lastError: null,
      leaseUntil: null,
      leaseToken: null,
    });
    const updated = await replaceJob(
      candidate,
      and(
        eq(schema.transactionalEmailJobs.logicalKey, logicalKey),
        eq(schema.transactionalEmailJobs.state, job.state),
      ),
    );
    return {
      created: false,
      job: updated ?? (await readJob(logicalKey)) ?? job,
    };
  }

  async function transition(
    logicalKey: string,
    expectedStates: readonly TransactionalEmailState[],
    nextState: TransactionalEmailState,
    changes: { generatedSummary?: string; lastError?: string | null } = {},
  ): Promise<TransactionalEmailJob | null> {
    const job = await readJob(logicalKey);
    if (
      !job ||
      !expectedStates.includes(job.state) ||
      job.state === "sending"
    ) {
      return null;
    }
    if (!allowedTransitions[job.state].has(nextState)) {
      throw new Error(
        `Invalid transactional email transition: ${job.state} -> ${nextState}`,
      );
    }
    return replaceJob(
      transitionedJob(job, nextState, changes),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        eq(schema.transactionalEmailJobs.state, job.state),
        isNull(schema.transactionalEmailJobs.leaseToken),
      ),
    );
  }

  async function claimAwaitingAi(logicalKey: string, claimantEmail: string) {
    const claimant = normalizeRecipient(claimantEmail);
    const job = await readJob(logicalKey);
    if (!job || !isAiBackedType(job.type) || job.state !== "awaiting_ai") {
      return null;
    }
    const timestamp = now().toISOString();
    return replaceJob(
      transactionalEmailJobSchema.parse({
        ...job,
        state: "ai_dispatched",
        aiClaimedBy: claimant,
        aiDispatchedAt: timestamp,
        updatedAt: timestamp,
      }),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        eq(schema.transactionalEmailJobs.state, "awaiting_ai"),
      ),
    );
  }

  async function reclaimStaleAiDispatch(
    logicalKey: string,
    claimantEmail: string,
    staleBefore: Date,
  ) {
    const claimant = normalizeRecipient(claimantEmail);
    const job = await readJob(logicalKey);
    const dispatchedAt = job?.aiDispatchedAt ?? job?.updatedAt;
    if (
      !job ||
      !isAiBackedType(job.type) ||
      job.state !== "ai_dispatched" ||
      !dispatchedAt ||
      Date.parse(dispatchedAt) > staleBefore.getTime()
    ) {
      return null;
    }
    const timestamp = now().toISOString();
    return replaceJob(
      transactionalEmailJobSchema.parse({
        ...job,
        aiClaimedBy: claimant,
        aiDispatchedAt: timestamp,
        updatedAt: timestamp,
      }),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        eq(schema.transactionalEmailJobs.state, "ai_dispatched"),
        lte(
          schema.transactionalEmailJobs.aiDispatchedAt,
          staleBefore.toISOString(),
        ),
      ),
    );
  }

  async function completeClaimedAi(
    logicalKey: string,
    claimantEmail: string,
    generatedSummary: string,
  ) {
    const claimant = normalizeRecipient(claimantEmail);
    const summary = z.string().max(20_000).parse(generatedSummary);
    const job = await readJob(logicalKey);
    if (
      !job ||
      job.type !== "two-clips" ||
      job.state !== "ai_dispatched" ||
      job.aiClaimedBy !== claimant
    ) {
      return null;
    }
    const timestamp = now().toISOString();
    return replaceJob(
      transactionalEmailJobSchema.parse({
        ...job,
        state: "ready",
        generatedSummary: summary,
        readyAt: timestamp,
        updatedAt: timestamp,
      }),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        eq(schema.transactionalEmailJobs.state, "ai_dispatched"),
        eq(schema.transactionalEmailJobs.aiClaimedBy, claimant),
      ),
    );
  }

  async function claimNextAwaitingAi() {
    const candidates = await getDb()
      .select({ logicalKey: schema.transactionalEmailJobs.logicalKey })
      .from(schema.transactionalEmailJobs)
      .where(eq(schema.transactionalEmailJobs.state, "awaiting_ai"))
      .orderBy(asc(schema.transactionalEmailJobs.createdAt));
    for (const candidate of candidates) {
      const claimed = await transition(
        candidate.logicalKey,
        ["awaiting_ai"],
        "ai_dispatched",
      );
      if (claimed) return claimed;
    }
    return null;
  }

  async function acquireSendingLease(
    logicalKey: string,
    leaseDurationMs: number,
  ) {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    const job = await readJob(logicalKey);
    if (!job) return null;
    const currentTime = now();
    const timestamp = currentTime.toISOString();
    if (
      job.state !== "ready" &&
      (job.state !== "sending" ||
        job.leaseUntil === null ||
        Date.parse(job.leaseUntil) > currentTime.getTime())
    ) {
      return null;
    }
    return replaceJob(
      transactionalEmailJobSchema.parse({
        ...job,
        state: "sending",
        attempts: job.attempts + 1,
        sendingAt: timestamp,
        updatedAt: timestamp,
        lastError: null,
        leaseUntil: new Date(
          currentTime.getTime() + leaseDurationMs,
        ).toISOString(),
        leaseToken: randomUUID(),
      }),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        or(
          eq(schema.transactionalEmailJobs.state, "ready"),
          and(
            eq(schema.transactionalEmailJobs.state, "sending"),
            lte(schema.transactionalEmailJobs.leaseUntil, timestamp),
          ),
        ),
      ),
    );
  }

  async function transitionSending(
    logicalKey: string,
    leaseToken: string,
    nextState: "sent" | "ready" | "cancelled" | "failed",
    changes: { lastError?: string | null } = {},
  ) {
    const parsedLeaseToken = nonEmptyStringSchema.parse(leaseToken);
    const job = await readJob(logicalKey);
    if (
      !job ||
      job.state !== "sending" ||
      job.leaseToken !== parsedLeaseToken
    ) {
      return null;
    }
    if (!allowedTransitions.sending.has(nextState)) {
      throw new Error(
        `Invalid transactional email transition: sending -> ${nextState}`,
      );
    }
    return replaceJob(
      transitionedJob(job, nextState, changes),
      and(
        eq(schema.transactionalEmailJobs.logicalKey, job.logicalKey),
        eq(schema.transactionalEmailJobs.state, "sending"),
        eq(schema.transactionalEmailJobs.leaseToken, parsedLeaseToken),
      ),
    );
  }

  async function readConfig(): Promise<TransactionalEmailConfig | null> {
    const [row] = await getDb()
      .select()
      .from(schema.transactionalEmailConfigs)
      .where(eq(schema.transactionalEmailConfigs.id, "default"))
      .limit(1);
    if (!row) return null;
    let config: unknown;
    try {
      config = JSON.parse(row.configJson);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`Invalid transactional email config JSON${detail}`);
    }
    return transactionalEmailConfigSchema.parse(config);
  }

  async function ensureEnabledAt(): Promise<TransactionalEmailConfig> {
    const config = transactionalEmailConfigSchema.parse({
      enabledAt: now().toISOString(),
    });
    const [created] = await getDb()
      .insert(schema.transactionalEmailConfigs)
      .values({ id: "default", configJson: JSON.stringify(config) })
      .onConflictDoNothing()
      .returning({ id: schema.transactionalEmailConfigs.id });
    if (created) return config;
    const existing = await readConfig();
    if (!existing) throw new Error("Transactional email config disappeared");
    return existing;
  }

  async function updateReconciliationCursor(
    cursorName: z.infer<typeof transactionalEmailCursorNameSchema>,
    reconciliationCursor: NonNullable<
      TransactionalEmailConfig["reconciliationCursor"]
    > | null,
  ): Promise<TransactionalEmailConfig> {
    const parsedCursorName =
      transactionalEmailCursorNameSchema.parse(cursorName);
    const parsedCursor = reconciliationCursorSchema.parse(reconciliationCursor);
    const config = await readConfig();
    if (!config)
      throw new Error("Transactional email config is not initialized");
    const nextConfig = transactionalEmailConfigSchema.parse({
      ...config,
      [parsedCursorName]: parsedCursor,
    });
    const [updated] = await getDb()
      .update(schema.transactionalEmailConfigs)
      .set({ configJson: JSON.stringify(nextConfig) })
      .where(
        and(
          eq(schema.transactionalEmailConfigs.id, "default"),
          eq(
            schema.transactionalEmailConfigs.configJson,
            JSON.stringify(config),
          ),
        ),
      )
      .returning();
    if (!updated)
      throw new Error("Transactional email config is being updated");
    return transactionalEmailConfigSchema.parse(JSON.parse(updated.configJson));
  }

  return {
    enqueue,
    enqueueOrConvergeFirstImport,
    readJob,
    listJobs,
    transition,
    claimAwaitingAi,
    reclaimStaleAiDispatch,
    completeClaimedAi,
    claimNextAwaitingAi,
    acquireSendingLease,
    transitionSending,
    ensureEnabledAt,
    updateReconciliationCursor,
    readConfig,
  };
}

export const transactionalEmailStore = createTransactionalEmailStore();
