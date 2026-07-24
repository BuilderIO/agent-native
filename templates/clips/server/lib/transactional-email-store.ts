import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const nonEmptyStringSchema = z.string().trim().min(1);
const recipientSchema = z.string().email();
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
      type: z.literal("two-clips"),
      ...commonPayloadFields,
      recordingIds: z.array(recordingIdSchema).length(2),
    })
    .strict(),
]);

export const transactionalEmailConfigSchema = z
  .object({
    enabledAt: timestampSchema,
    reconciliationCursor: z
      .object({
        createdAt: timestampSchema,
        id: nonEmptyStringSchema,
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const transactionalEmailJobSchema = z
  .object({
    logicalKey: nonEmptyStringSchema,
    type: z.enum([
      "first-view",
      "unviewed-reminder",
      "first-import",
      "two-clips",
    ]),
    state: transactionalEmailStateSchema,
    recipient: recipientSchema,
    recordingIds: z.array(recordingIdSchema).min(1),
    shareId: nonEmptyStringSchema.optional(),
    requestedBy: nonEmptyStringSchema.optional(),
    generatedSummary: z.string().max(20_000).optional(),
    attempts: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    aiDispatchedAt: timestampSchema.optional(),
    readyAt: timestampSchema.optional(),
    sendingAt: timestampSchema.optional(),
    sentAt: timestampSchema.optional(),
    cancelledAt: timestampSchema.optional(),
    failedAt: timestampSchema.optional(),
    lastError: z.string().max(4_000).nullable(),
    leaseUntil: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    const parsedPayload = transactionalEmailPayloadSchema.safeParse({
      type: job.type,
      recipient: job.recipient,
      recordingIds: job.recordingIds,
      shareId: job.shareId,
      requestedBy: job.requestedBy,
    });
    if (!parsedPayload.success) {
      context.addIssue({
        code: "custom",
        message: "Job payload does not match its transactional email type",
      });
    }
    if (job.state === "sending" && job.leaseUntil === null) {
      context.addIssue({
        code: "custom",
        message: "Sending jobs require a leaseUntil timestamp",
        path: ["leaseUntil"],
      });
    }
    if (job.state !== "sending" && job.leaseUntil !== null) {
      context.addIssue({
        code: "custom",
        message: "Only sending jobs may have a leaseUntil timestamp",
        path: ["leaseUntil"],
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

export type TransactionalEmailStoreOptions = {
  root?: string;
  now?: () => Date;
};

const LOCK_STALE_MS = 30_000;

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

  async function withJobLock<T>(
    logicalKey: string,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    await ensureDirectories();
    const file = lockFile(logicalKey);
    let handle;
    try {
      handle = await open(file, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const lockStat = await stat(file).catch(() => null);
      if (!lockStat || Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) {
        return null;
      }
      await rm(file, { force: true });
      try {
        handle = await open(file, "wx", 0o600);
      } catch (retryError) {
        if (isNodeError(retryError, "EEXIST")) return null;
        throw retryError;
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(file, { force: true });
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
    });
    try {
      await writeFile(jobFile(parsedKey), `${JSON.stringify(job, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return { created: true, job };
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const existing = await readJob(parsedKey);
      if (!existing) {
        throw new Error(`Transactional email job disappeared for ${parsedKey}`);
      }
      return { created: false, job: existing };
    }
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
        ...(timestampField ? { [timestampField]: timestamp } : {}),
      });
      await writeJsonAtomic(jobFile(logicalKey), updated);
      return updated;
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
    reconciliationCursor: NonNullable<
      TransactionalEmailConfig["reconciliationCursor"]
    > | null,
  ): Promise<TransactionalEmailConfig> {
    const parsedCursor =
      transactionalEmailConfigSchema.shape.reconciliationCursor.parse(
        reconciliationCursor,
      );
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
          reconciliationCursor: parsedCursor,
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
    readJob,
    listJobs,
    transition,
    claimNextAwaitingAi,
    acquireSendingLease,
    ensureEnabledAt,
    updateReconciliationCursor,
    readConfig,
  };
}

export const transactionalEmailStore = createTransactionalEmailStore();
