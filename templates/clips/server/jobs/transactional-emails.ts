import { isEmailConfigured } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "../lib/recordings.js";
import {
  transactionalEmailStore,
  type TransactionalEmailJob,
} from "../lib/transactional-email-store.js";
import {
  sendClipsTransactionalEmail,
  type ClipsTransactionalEmailInput,
} from "../lib/transactional-email-templates.js";

const JOB_INTERVAL_MS = 60_000;
const RECONCILIATION_BATCH_SIZE = 100;
const RECIPIENT_SHARE_BATCH_SIZE = 100;
const DELIVERY_BATCH_SIZE = 25;
const REMINDER_DELAY_MS = 48 * 60 * 60 * 1000;
const SENDING_LEASE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 60_000;
let skippingLogged = false;

type DirectShare = {
  id: string;
  recordingId: string;
  recipient: string;
  createdBy: string;
  createdAt: string;
};

type RecordingState = {
  id: string;
  ownerEmail: string;
  title: string;
  titleSource: string;
  sourceAppName: string | null;
  createdAt: string;
  status: string;
  archivedAt: string | null;
  trashedAt: string | null;
};

type CountedView = {
  viewerEmail: string | null;
};

type ReconciliationCursor = {
  createdAt: string;
  id: string;
};

export type TransactionalEmailStore = Pick<
  typeof transactionalEmailStore,
  | "ensureEnabledAt"
  | "enqueue"
  | "listJobs"
  | "transition"
  | "acquireSendingLease"
  | "updateReconciliationCursor"
>;

export interface TransactionalEmailRepository {
  listDirectShares(
    enabledAt: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<DirectShare[]>;
  listRecipientShares(
    recipient: string,
    enabledAt: string,
    limit: number,
  ): Promise<DirectShare[]>;
  getRecording(recordingId: string): Promise<RecordingState | null>;
  recipientOwnsRecording(recipient: string): Promise<boolean>;
  recipientHasShare(
    recipient: string,
    recordingId: string,
    shareId: string,
  ): Promise<boolean>;
  recipientHasShares(
    recipient: string,
    recordingIds: readonly string[],
  ): Promise<boolean>;
  recipientHasCountedView(
    recipient: string,
    recordingId: string,
  ): Promise<boolean>;
  getFirstNonOwnerCountedView(
    recordingId: string,
    ownerEmail: string,
  ): Promise<CountedView | null>;
  isFirstImport(
    recording: RecordingState,
    recipient: string,
    enabledAt: string,
  ): Promise<boolean>;
}

export interface TransactionalEmailWorkerDependencies {
  store?: TransactionalEmailStore;
  repository?: TransactionalEmailRepository;
  now?: () => Date;
  emailConfigured?: () => Promise<boolean>;
  send?: (input: ClipsTransactionalEmailInput) => Promise<void>;
  reconciliationBatchSize?: number;
  deliveryBatchSize?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface TransactionalEmailWorkerResult {
  enqueued: number;
  cancelled: number;
  retried: number;
  failed: number;
  sent: number;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || /\s/.test(email)) return null;
  return email;
}

export function isSuppressedTransactionalRecipient(
  value: string | null | undefined,
): boolean {
  const email = normalizedEmail(value);
  if (!email || email === "local@localhost") return true;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return (
    local.includes("+qa") &&
    (domain === "example.test" ||
      domain.endsWith(".test") ||
      domain === "example.invalid" ||
      domain.endsWith(".invalid"))
  );
}

function normalizeShare(share: DirectShare): DirectShare | null {
  const recipient = normalizedEmail(share.recipient);
  if (!recipient || isSuppressedTransactionalRecipient(recipient)) return null;
  return { ...share, recipient };
}

function isImportedRecording(recording: RecordingState): boolean {
  return (
    recording.sourceAppName === "Loom" ||
    recording.sourceAppName === "Video link"
  );
}

function isActiveReadyRecording(
  recording: RecordingState | null,
): recording is RecordingState {
  return Boolean(
    recording &&
    recording.status === "ready" &&
    recording.archivedAt === null &&
    recording.trashedAt === null,
  );
}

function defaultRepository(): TransactionalEmailRepository {
  const db = getDb();

  const selectShares = async (
    enabledAt: string,
    limit: number,
    recipient?: string,
    cursor?: ReconciliationCursor | null,
  ): Promise<DirectShare[]> => {
    const rows = await db
      .select({
        id: schema.recordingShares.id,
        recordingId: schema.recordingShares.resourceId,
        recipient: schema.recordingShares.principalId,
        createdBy: schema.recordingShares.createdBy,
        createdAt: schema.recordingShares.createdAt,
      })
      .from(schema.recordingShares)
      .where(
        and(
          eq(schema.recordingShares.principalType, "user"),
          recipient
            ? ownerEmailMatches(schema.recordingShares.principalId, recipient)
            : undefined,
          gte(schema.recordingShares.createdAt, enabledAt),
          cursor
            ? or(
                gt(schema.recordingShares.createdAt, cursor.createdAt),
                and(
                  eq(schema.recordingShares.createdAt, cursor.createdAt),
                  gt(schema.recordingShares.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(schema.recordingShares.createdAt),
        asc(schema.recordingShares.id),
      )
      .limit(limit);
    return rows;
  };

  return {
    listDirectShares: (enabledAt, cursor, limit) =>
      selectShares(enabledAt, limit, undefined, cursor),
    listRecipientShares: (recipient, enabledAt, limit) =>
      selectShares(enabledAt, limit, recipient),
    async getRecording(recordingId) {
      const [recording] = await db
        .select({
          id: schema.recordings.id,
          ownerEmail: schema.recordings.ownerEmail,
          title: schema.recordings.title,
          titleSource: schema.recordings.titleSource,
          sourceAppName: schema.recordings.sourceAppName,
          createdAt: schema.recordings.createdAt,
          status: schema.recordings.status,
          archivedAt: schema.recordings.archivedAt,
          trashedAt: schema.recordings.trashedAt,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recordingId))
        .limit(1);
      return recording ?? null;
    },
    async recipientOwnsRecording(recipient) {
      const [recording] = await db
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(ownerEmailMatches(schema.recordings.ownerEmail, recipient))
        .limit(1);
      return Boolean(recording);
    },
    async recipientHasShare(recipient, recordingId, shareId) {
      const [share] = await db
        .select({ recipient: schema.recordingShares.principalId })
        .from(schema.recordingShares)
        .where(
          and(
            eq(schema.recordingShares.id, shareId),
            eq(schema.recordingShares.resourceId, recordingId),
            eq(schema.recordingShares.principalType, "user"),
          ),
        )
        .limit(1);
      return normalizedEmail(share?.recipient) === recipient;
    },
    async recipientHasShares(recipient, recordingIds) {
      if (recordingIds.length === 0) return false;
      const rows = await db
        .select({
          recordingId: schema.recordingShares.resourceId,
          recipient: schema.recordingShares.principalId,
        })
        .from(schema.recordingShares)
        .where(
          and(
            eq(schema.recordingShares.principalType, "user"),
            inArray(schema.recordingShares.resourceId, [...recordingIds]),
          ),
        )
        .limit(Math.max(recordingIds.length * 4, recordingIds.length));
      const sharedIds = new Set(
        rows
          .filter((share) => normalizedEmail(share.recipient) === recipient)
          .map((share) => share.recordingId),
      );
      return recordingIds.every((recordingId) => sharedIds.has(recordingId));
    },
    async recipientHasCountedView(recipient, recordingId) {
      const views = await db
        .select({ viewerEmail: schema.recordingViews.viewerEmail })
        .from(schema.recordingViews)
        .where(
          and(
            eq(schema.recordingViews.recordingId, recordingId),
            isNotNull(schema.recordingViews.viewerEmail),
          ),
        )
        .limit(100);
      return views.some(
        (view) => normalizedEmail(view.viewerEmail) === recipient,
      );
    },
    async getFirstNonOwnerCountedView(recordingId, ownerEmail) {
      const [view] = await db
        .select({ viewerEmail: schema.recordingViews.viewerEmail })
        .from(schema.recordingViews)
        .where(
          and(
            eq(schema.recordingViews.recordingId, recordingId),
            or(
              isNull(schema.recordingViews.viewerEmail),
              not(
                ownerEmailMatches(
                  schema.recordingViews.viewerEmail,
                  ownerEmail,
                ),
              ),
            ),
          ),
        )
        .orderBy(
          asc(schema.recordingViews.viewedAt),
          asc(schema.recordingViews.id),
        )
        .limit(1);
      return view ?? null;
    },
    async isFirstImport(recording, recipient, enabledAt) {
      if (!isImportedRecording(recording)) return false;
      const imports = await db
        .select({
          id: schema.recordings.id,
          titleSource: schema.recordings.titleSource,
          sourceAppName: schema.recordings.sourceAppName,
        })
        .from(schema.recordings)
        .where(
          and(
            ownerEmailMatches(schema.recordings.ownerEmail, recipient),
            eq(schema.recordings.status, "ready"),
            gte(schema.recordings.createdAt, enabledAt),
            lte(schema.recordings.createdAt, recording.createdAt),
            or(
              eq(schema.recordings.sourceAppName, "Loom"),
              eq(schema.recordings.sourceAppName, "Video link"),
            ),
          ),
        )
        .orderBy(asc(schema.recordings.createdAt), asc(schema.recordings.id))
        .limit(1);
      return imports[0]?.id === recording.id;
    },
  };
}

async function reconcileShares(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  now: Date,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const page = await repository.listDirectShares(enabledAt, cursor, limit);
  const shares = page
    .map(normalizeShare)
    .filter((share): share is DirectShare => share !== null);
  let enqueued = 0;

  for (const share of shares) {
    if (now.getTime() - Date.parse(share.createdAt) >= REMINDER_DELAY_MS) {
      const result = await store.enqueue(`unviewed-reminder:${share.id}`, {
        type: "unviewed-reminder",
        recipient: share.recipient,
        recordingIds: [share.recordingId],
        shareId: share.id,
        requestedBy: share.createdBy,
      });
      if (result.created) enqueued += 1;
    }
  }

  for (const recipient of new Set(shares.map((share) => share.recipient))) {
    if (await repository.recipientOwnsRecording(recipient)) continue;
    const recipientShares = (
      await repository.listRecipientShares(
        recipient,
        enabledAt,
        RECIPIENT_SHARE_BATCH_SIZE,
      )
    )
      .map(normalizeShare)
      .filter((share): share is DirectShare => share !== null)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    const uniqueShares: DirectShare[] = [];
    const recordingIds = new Set<string>();
    for (const share of recipientShares) {
      if (recordingIds.has(share.recordingId)) continue;
      recordingIds.add(share.recordingId);
      uniqueShares.push(share);
      if (uniqueShares.length === 2) break;
    }
    if (uniqueShares.length !== 2) continue;
    const secondShare = uniqueShares[1];
    const result = await store.enqueue(
      `two-clips:${recipient}`,
      {
        type: "two-clips",
        recipient,
        recordingIds: uniqueShares.map((share) => share.recordingId),
        shareId: secondShare.id,
        requestedBy: secondShare.createdBy,
      },
      "awaiting_ai",
    );
    if (result.created) enqueued += 1;
  }

  const lastShare = page[page.length - 1];
  return {
    enqueued,
    nextCursor:
      page.length >= limit && lastShare
        ? { createdAt: lastShare.createdAt, id: lastShare.id }
        : null,
  };
}

async function makeSendInput(
  job: TransactionalEmailJob,
  repository: TransactionalEmailRepository,
  enabledAt: string,
): Promise<ClipsTransactionalEmailInput | null> {
  const recipient = normalizedEmail(job.recipient);
  if (!recipient || isSuppressedTransactionalRecipient(recipient)) return null;
  const recordings = await Promise.all(
    job.recordingIds.map((recordingId) => repository.getRecording(recordingId)),
  );
  if (!recordings.every(isActiveReadyRecording)) return null;

  if (job.type === "unviewed-reminder") {
    if (
      !job.shareId ||
      !(await repository.recipientHasShare(
        recipient,
        job.recordingIds[0],
        job.shareId,
      )) ||
      (await repository.recipientHasCountedView(recipient, job.recordingIds[0]))
    ) {
      return null;
    }
    return {
      kind: "unviewed-reminder",
      to: recipient,
      recordingId: recordings[0].id,
      title: recordings[0].title,
      senderEmail: job.requestedBy ?? recordings[0].ownerEmail,
    };
  }

  if (job.type === "two-clips") {
    if (
      (await repository.recipientOwnsRecording(recipient)) ||
      !(await repository.recipientHasShares(recipient, job.recordingIds))
    ) {
      return null;
    }
    return {
      kind: "two-clips",
      to: recipient,
      generatedSummary: job.generatedSummary,
    };
  }

  if (job.type === "first-import") {
    if (
      normalizedEmail(recordings[0].ownerEmail) !== recipient ||
      !(await repository.isFirstImport(recordings[0], recipient, enabledAt))
    ) {
      return null;
    }
    return {
      kind: "first-import",
      to: recipient,
      recordingId: recordings[0].id,
      title: recordings[0].title,
    };
  }

  if (normalizedEmail(recordings[0].ownerEmail) !== recipient) return null;
  const firstView = await repository.getFirstNonOwnerCountedView(
    recordings[0].id,
    recordings[0].ownerEmail,
  );
  if (!firstView) return null;
  return {
    kind: "first-view",
    to: recipient,
    recordingId: recordings[0].id,
    title: recordings[0].title,
    viewerEmail: firstView.viewerEmail,
  };
}

function isRetryDue(
  job: TransactionalEmailJob,
  now: Date,
  retryBaseDelayMs: number,
): boolean {
  if (job.state === "sending") {
    return Boolean(
      job.leaseUntil && Date.parse(job.leaseUntil) <= now.getTime(),
    );
  }
  if (job.attempts === 0) return true;
  const readyAt = job.readyAt ? Date.parse(job.readyAt) : 0;
  const delay = retryBaseDelayMs * 2 ** Math.max(0, job.attempts - 1);
  return readyAt + delay <= now.getTime();
}

export async function runTransactionalEmailsOnce(
  dependencies: TransactionalEmailWorkerDependencies = {},
): Promise<TransactionalEmailWorkerResult> {
  return runWithRequestContext({}, async () => {
    const store = dependencies.store ?? transactionalEmailStore;
    const repository = dependencies.repository ?? defaultRepository();
    const now = dependencies.now ?? (() => new Date());
    const result: TransactionalEmailWorkerResult = {
      enqueued: 0,
      cancelled: 0,
      retried: 0,
      failed: 0,
      sent: 0,
    };
    const config = await store.ensureEnabledAt();
    const currentTime = now();
    const reconciliation = await reconcileShares(
      repository,
      store,
      config.enabledAt,
      config.reconciliationCursor ?? null,
      currentTime,
      dependencies.reconciliationBatchSize ?? RECONCILIATION_BATCH_SIZE,
    );
    result.enqueued = reconciliation.enqueued;
    await store.updateReconciliationCursor(reconciliation.nextCursor);

    const jobs = await store.listJobs();
    for (const job of jobs) {
      if (
        job.state === "pending" &&
        (job.type === "first-view" ||
          job.type === "first-import" ||
          job.type === "unviewed-reminder")
      ) {
        await store.transition(job.logicalKey, ["pending"], "ready");
      }
    }

    if (!(await (dependencies.emailConfigured ?? isEmailConfigured)())) {
      return result;
    }

    const deliveryCandidates = (await store.listJobs())
      .filter(
        (job) =>
          (job.state === "ready" || job.state === "sending") &&
          isRetryDue(
            job,
            currentTime,
            dependencies.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS,
          ),
      )
      .slice(0, dependencies.deliveryBatchSize ?? DELIVERY_BATCH_SIZE);

    const maxAttempts = dependencies.maxAttempts ?? MAX_ATTEMPTS;
    for (const candidate of deliveryCandidates) {
      if (candidate.attempts >= maxAttempts) {
        if (
          await store.transition(
            candidate.logicalKey,
            [candidate.state],
            "failed",
            {
              lastError:
                candidate.lastError ?? "Maximum delivery attempts reached",
            },
          )
        ) {
          result.failed += 1;
        }
        continue;
      }
      const leased = await store.acquireSendingLease(
        candidate.logicalKey,
        dependencies.leaseDurationMs ?? SENDING_LEASE_MS,
      );
      if (!leased) continue;

      const input = await makeSendInput(leased, repository, config.enabledAt);
      if (!input) {
        if (
          await store.transition(leased.logicalKey, ["sending"], "cancelled")
        ) {
          result.cancelled += 1;
        }
        continue;
      }

      try {
        await (dependencies.send ?? sendClipsTransactionalEmail)(input);
        if (await store.transition(leased.logicalKey, ["sending"], "sent")) {
          result.sent += 1;
        }
      } catch (error) {
        const message = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 4_000);
        if (leased.attempts >= maxAttempts) {
          if (
            await store.transition(leased.logicalKey, ["sending"], "failed", {
              lastError: message,
            })
          ) {
            result.failed += 1;
          }
        } else if (
          await store.transition(leased.logicalKey, ["sending"], "ready", {
            lastError: message,
          })
        ) {
          result.retried += 1;
        }
      }
    }

    return result;
  });
}

export default function registerTransactionalEmailsJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[transactional-emails] Skipping background delivery (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    runTransactionalEmailsOnce().catch((error) =>
      console.error("[transactional-emails] interval failed:", error),
    );
  }, JOB_INTERVAL_MS);
  console.log(
    `[transactional-emails] Recurring reconciliation and delivery every ${JOB_INTERVAL_MS / 1000}s.`,
  );
}
