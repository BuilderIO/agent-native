import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

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
    generatedRecapCopy: recapCopySchema.optional(),
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
  return type === "two-clips" || type === "monthly-recap";
}

export type TransactionalEmailStoreOptions = {
  root?: string;
  now?: () => Date;
  testHooks?: {
    afterInitialJobTempSynced?: () => Promise<void>;
    afterStaleLockSnapshot?: () => Promise<void>;
    afterJobLockAcquired?: () => Promise<void>;
    afterFreshLockContention?: () => Promise<void>;
  };
};

const LOCK_STALE_MS = 30_000;
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

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function jobHash(logicalKey: string): string {
  return createHash("sha256").update(logicalKey).digest("hex");
}

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

export function createTransactionalEmailStore(
  options: TransactionalEmailStoreOptions = {},
) {
  const root =
    options.root ??
    path.join(process.cwd(), "data", "clips-transactional-emails");
  const jobsDirectory = path.join(root, "jobs");
  const locksDirectory = path.join(root, "locks");
  const configFile = path.join(root, "config.json");
  const now = options.now ?? (() => new Date());
  const testHooks = options.testHooks;

  const jobFile = (logicalKey: string) =>
    path.join(jobsDirectory, `${jobHash(logicalKey)}.json`);
  const lockFile = (logicalKey: string) =>
    path.join(locksDirectory, `${jobHash(logicalKey)}.lock`);

  async function ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(jobsDirectory, { recursive: true, mode: 0o700 }),
      mkdir(locksDirectory, { recursive: true, mode: 0o700 }),
    ]);
  }

  async function parseJsonFile<T>(
    file: string,
    schema: z.ZodType<T>,
    description: string,
  ): Promise<T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw error;
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`Invalid ${description} JSON at ${file}${detail}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid ${description} at ${file}: ${result.error.message}`,
      );
    }
    return result.data;
  }

  async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const temporaryFile = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryFile, file);
    } catch (error) {
      await rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function publishJsonExclusive(
    file: string,
    value: unknown,
  ): Promise<boolean> {
    const temporaryFile = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await testHooks?.afterInitialJobTempSynced?.();
      try {
        await link(temporaryFile, file);
        const directoryHandle = await open(path.dirname(file), "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
        return true;
      } catch (error) {
        if (isNodeError(error, "EEXIST")) return false;
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporaryFile, { force: true }).catch(() => undefined);
    }
  }

  async function readJob(
    logicalKey: string,
  ): Promise<TransactionalEmailJob | null> {
    const file = jobFile(logicalKey);
    try {
      const job = await parseJsonFile(
        file,
        transactionalEmailJobSchema,
        "transactional email job",
      );
      if (job.logicalKey !== logicalKey) {
        throw new Error(`Transactional email job key mismatch at ${file}`);
      }
      return job;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  async function listJobs(): Promise<TransactionalEmailJob[]> {
    await ensureDirectories();
    const files = (await readdir(jobsDirectory))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const jobs = await Promise.all(
      files.map(async (filename) => {
        const file = path.join(jobsDirectory, filename);
        const job = await parseJsonFile(
          file,
          transactionalEmailJobSchema,
          "transactional email job",
        );
        if (filename !== `${jobHash(job.logicalKey)}.json`) {
          throw new Error(`Transactional email job key mismatch at ${file}`);
        }
        return job;
      }),
    );
    return jobs.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  type FileIdentity = { dev: number; ino: number };

  function identityOf(value: { dev: number; ino: number }): FileIdentity {
    return { dev: value.dev, ino: value.ino };
  }

  function sameIdentity(
    left: FileIdentity | null,
    right: FileIdentity | null,
  ): boolean {
    return (
      left !== null &&
      right !== null &&
      left.dev === right.dev &&
      left.ino === right.ino
    );
  }

  async function fileIdentity(file: string): Promise<FileIdentity | null> {
    const value = await stat(file).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    });
    return value ? identityOf(value) : null;
  }

  async function unlinkIfIdentity(
    file: string,
    expected: FileIdentity,
  ): Promise<boolean> {
    if (!sameIdentity(await fileIdentity(file), expected)) return false;
    try {
      await unlink(file);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  async function createLockOwner(file: string): Promise<FileIdentity> {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.sync();
      return identityOf(await handle.stat());
    } finally {
      await handle.close();
    }
  }

  async function takeoverMarkerBlocks(file: string): Promise<boolean> {
    const existing = await stat(file).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    });
    if (!existing) return false;
    if (Date.now() - existing.mtimeMs <= LOCK_STALE_MS) return true;
    return !(await unlinkIfIdentity(file, identityOf(existing)));
  }

  async function acquireTakeoverMarker(
    ownerFile: string,
    takeoverFile: string,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await link(ownerFile, takeoverFile);
        return true;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        if (await takeoverMarkerBlocks(takeoverFile)) return false;
      }
    }
    return false;
  }

  async function withJobLock<T>(
    logicalKey: string,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    await ensureDirectories();
    const file = lockFile(logicalKey);
    const ownerFile = `${file}.${process.pid}.${randomUUID()}.owner`;
    const takeoverFile = `${file}.takeover`;
    const ownerIdentity = await createLockOwner(ownerFile);
    let acquired = false;
    let ownsTakeover = false;
    try {
      if (await takeoverMarkerBlocks(takeoverFile)) return null;
      try {
        await link(ownerFile, file);
        acquired = true;
        if (await takeoverMarkerBlocks(takeoverFile)) return null;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        const existingLock = await stat(file).catch((statError: unknown) => {
          if (isNodeError(statError, "ENOENT")) return null;
          throw statError;
        });
        if (
          existingLock &&
          Date.now() - existingLock.mtimeMs <= LOCK_STALE_MS
        ) {
          await testHooks?.afterFreshLockContention?.();
          return null;
        }
        ownsTakeover = await acquireTakeoverMarker(ownerFile, takeoverFile);
        if (!ownsTakeover) return null;
        const lockStat = await stat(file).catch(() => null);
        if (!lockStat || Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) {
          return null;
        }
        const staleIdentity = identityOf(lockStat);
        await testHooks?.afterStaleLockSnapshot?.();
        if (!sameIdentity(await fileIdentity(file), staleIdentity)) return null;
        if (!(await unlinkIfIdentity(file, staleIdentity))) return null;
        try {
          await link(ownerFile, file);
          acquired = true;
        } catch (retryError) {
          if (isNodeError(retryError, "EEXIST")) return null;
          throw retryError;
        }
      }
      await testHooks?.afterJobLockAcquired?.();
      if (!sameIdentity(await fileIdentity(file), ownerIdentity)) return null;
      return await operation();
    } finally {
      // A holder only releases the inode it acquired. A stale reclaimer may
      // replace that inode while the original holder is paused; identity-based
      // release preserves the replacement without a cleanup-time takeover race.
      if (acquired) await unlinkIfIdentity(file, ownerIdentity);
      if (ownsTakeover) {
        await unlinkIfIdentity(takeoverFile, ownerIdentity);
      }
      await rm(ownerFile, { force: true });
    }
  }

  async function enqueue(
    logicalKey: string,
    payload: TransactionalEmailPayload,
    initialState: "pending" | "awaiting_ai" = "pending",
  ): Promise<{ created: boolean; job: TransactionalEmailJob }> {
    const parsedKey = nonEmptyStringSchema.parse(logicalKey);
    const parsedPayload = transactionalEmailPayloadSchema.parse(payload);
    await ensureDirectories();
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
    if (await publishJsonExclusive(jobFile(parsedKey), job)) {
      return { created: true, job };
    }
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
  ): Promise<{ created: boolean; job: TransactionalEmailJob }> {
    const logicalKey = `first-import:${recipient.trim().toLowerCase()}`;
    const enqueued = await enqueue(logicalKey, {
      type: "first-import",
      recipient,
      recordingIds: [recordingId],
      requestedBy,
    });
    if (enqueued.created || enqueued.job.state === "sent") return enqueued;

    const converged = await withJobLock(logicalKey, async () => {
      const job = await readJob(logicalKey);
      if (
        !job ||
        job.type !== "first-import" ||
        !["pending", "ready", "cancelled"].includes(job.state)
      ) {
        return null;
      }
      if (job.recordingIds[0] === recordingId) return job;
      const timestamp = now().toISOString();
      const updated = transactionalEmailJobSchema.parse({
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
      await writeJsonAtomic(jobFile(logicalKey), updated);
      return updated;
    });
    return { created: false, job: converged ?? enqueued.job };
  }

  async function transition(
    logicalKey: string,
    expectedStates: readonly TransactionalEmailState[],
    nextState: TransactionalEmailState,
    changes: {
      generatedSummary?: string;
      lastError?: string | null;
    } = {},
  ): Promise<TransactionalEmailJob | null> {
    return withJobLock(logicalKey, async () => {
      const job = await readJob(logicalKey);
      if (!job || !expectedStates.includes(job.state)) return null;
      if (job.state === "sending") return null;
      if (!allowedTransitions[job.state].has(nextState)) {
        throw new Error(
          `Invalid transactional email transition: ${job.state} -> ${nextState}`,
        );
      }
      const timestamp = now().toISOString();
      const timestampField = stateTimestampField(nextState);
      const updated = transactionalEmailJobSchema.parse({
        ...job,
        ...changes,
        state: nextState,
        updatedAt: timestamp,
        leaseUntil: null,
        leaseToken: null,
        ...(timestampField ? { [timestampField]: timestamp } : {}),
      });
      await writeJsonAtomic(jobFile(logicalKey), updated);
      return updated;
    });
  }

  async function claimAwaitingAi(
    logicalKey: string,
    claimantEmail: string,
  ): Promise<TransactionalEmailJob | null> {
    const claimant = recipientSchema.parse(claimantEmail.trim().toLowerCase());
    return withJobLock(logicalKey, async () => {
      const job = await readJob(logicalKey);
      if (!job || !isAiBackedType(job.type) || job.state !== "awaiting_ai") {
        return null;
      }
      const timestamp = now().toISOString();
      const claimed = transactionalEmailJobSchema.parse({
        ...job,
        state: "ai_dispatched",
        aiClaimedBy: claimant,
        aiDispatchedAt: timestamp,
        updatedAt: timestamp,
      });
      await writeJsonAtomic(jobFile(logicalKey), claimed);
      return claimed;
    });
  }

  async function reclaimStaleAiDispatch(
    logicalKey: string,
    claimantEmail: string,
    staleBefore: Date,
  ): Promise<TransactionalEmailJob | null> {
    const claimant = recipientSchema.parse(claimantEmail.trim().toLowerCase());
    return withJobLock(logicalKey, async () => {
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
      const reclaimed = transactionalEmailJobSchema.parse({
        ...job,
        aiClaimedBy: claimant,
        aiDispatchedAt: timestamp,
        updatedAt: timestamp,
      });
      await writeJsonAtomic(jobFile(logicalKey), reclaimed);
      return reclaimed;
    });
  }

  async function completeClaimedAi(
    logicalKey: string,
    claimantEmail: string,
    generatedSummary: string,
  ): Promise<TransactionalEmailJob | null> {
    const claimant = recipientSchema.parse(claimantEmail.trim().toLowerCase());
    return withJobLock(logicalKey, async () => {
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
      const completed = transactionalEmailJobSchema.parse({
        ...job,
        state: "ready",
        generatedSummary,
        readyAt: timestamp,
        updatedAt: timestamp,
      });
      await writeJsonAtomic(jobFile(logicalKey), completed);
      return completed;
    });
  }

  async function completeClaimedRecapCopy(
    logicalKey: string,
    claimantEmail: string,
    generatedRecapCopy: RecapCopy,
  ): Promise<TransactionalEmailJob | null> {
    const claimant = recipientSchema.parse(claimantEmail.trim().toLowerCase());
    const parsedCopy = recapCopySchema.parse(generatedRecapCopy);
    return withJobLock(logicalKey, async () => {
      const job = await readJob(logicalKey);
      if (
        !job ||
        job.type !== "monthly-recap" ||
        job.state !== "ai_dispatched" ||
        job.aiClaimedBy !== claimant
      ) {
        return null;
      }
      const timestamp = now().toISOString();
      const completed = transactionalEmailJobSchema.parse({
        ...job,
        state: "ready",
        generatedRecapCopy: parsedCopy,
        readyAt: timestamp,
        updatedAt: timestamp,
      });
      await writeJsonAtomic(jobFile(logicalKey), completed);
      return completed;
    });
  }

  async function claimNextAwaitingAi(): Promise<TransactionalEmailJob | null> {
    const candidates = (await listJobs()).filter(
      (job) => job.state === "awaiting_ai",
    );
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
  ): Promise<TransactionalEmailJob | null> {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    return withJobLock(logicalKey, async () => {
      const job = await readJob(logicalKey);
      if (!job) return null;
      const currentTime = now();
      const canAcquire =
        job.state === "ready" ||
        (job.state === "sending" &&
          job.leaseUntil !== null &&
          Date.parse(job.leaseUntil) <= currentTime.getTime());
      if (!canAcquire) return null;
      const timestamp = currentTime.toISOString();
      const updated = transactionalEmailJobSchema.parse({
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
      });
      await writeJsonAtomic(jobFile(logicalKey), updated);
      return updated;
    });
  }

  async function transitionSending(
    logicalKey: string,
    leaseToken: string,
    nextState: "sent" | "ready" | "cancelled" | "failed",
    changes: { lastError?: string | null } = {},
  ): Promise<TransactionalEmailJob | null> {
    const parsedLeaseToken = nonEmptyStringSchema.parse(leaseToken);
    return withJobLock(logicalKey, async () => {
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
      const timestamp = now().toISOString();
      const timestampField = stateTimestampField(nextState);
      const updated = transactionalEmailJobSchema.parse({
        ...job,
        ...changes,
        state: nextState,
        updatedAt: timestamp,
        leaseUntil: null,
        leaseToken: null,
        ...(timestampField ? { [timestampField]: timestamp } : {}),
      });
      await writeJsonAtomic(jobFile(logicalKey), updated);
      return updated;
    });
  }

  async function ensureEnabledAt(): Promise<TransactionalEmailConfig> {
    await ensureDirectories();
    const config = transactionalEmailConfigSchema.parse({
      enabledAt: now().toISOString(),
    });
    try {
      await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return config;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      return parseJsonFile(
        configFile,
        transactionalEmailConfigSchema,
        "transactional email config",
      );
    }
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
    const updated = await withJobLock(
      "transactional-email-config",
      async () => {
        const config = await parseJsonFile(
          configFile,
          transactionalEmailConfigSchema,
          "transactional email config",
        );
        const nextConfig = transactionalEmailConfigSchema.parse({
          ...config,
          [parsedCursorName]: parsedCursor,
        });
        await writeJsonAtomic(configFile, nextConfig);
        return nextConfig;
      },
    );
    if (!updated) {
      throw new Error("Transactional email config is being updated");
    }
    return updated;
  }

  async function readConfig(): Promise<TransactionalEmailConfig | null> {
    try {
      return await parseJsonFile(
        configFile,
        transactionalEmailConfigSchema,
        "transactional email config",
      );
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  return {
    root,
    enqueue,
    enqueueOrConvergeFirstImport,
    readJob,
    listJobs,
    transition,
    claimAwaitingAi,
    reclaimStaleAiDispatch,
    completeClaimedAi,
    completeClaimedRecapCopy,
    claimNextAwaitingAi,
    acquireSendingLease,
    transitionSending,
    ensureEnabledAt,
    updateReconciliationCursor,
    readConfig,
  };
}

export const transactionalEmailStore = createTransactionalEmailStore();
