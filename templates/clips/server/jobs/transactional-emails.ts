import { isEmailConfigured } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getUserProfile } from "@agent-native/core/user-profile/server";
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
  min,
  not,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { UNKNOWN_AGENT_LABEL } from "../lib/agent-views.js";
import {
  computeMonthlyRecap,
  listOwnersWithMonthlyAudience,
  previousRecapMonth,
  recapMonthRange,
  type MonthlyRecap,
} from "../lib/recap-metrics.js";
import { ownerEmailMatches } from "../lib/recordings.js";
import {
  AI_DISPATCH_STALE_MS,
  transactionalEmailRecipientSchema,
  transactionalEmailStore,
  type TransactionalEmailJob,
} from "../lib/transactional-email-store.js";
import {
  sendClipsTransactionalEmail,
  type ClipsTransactionalEmailInput,
} from "../lib/transactional-email-templates.js";

const JOB_INTERVAL_MS = 60_000;
const RECONCILIATION_BATCH_SIZE = 100;
const RECONCILIATION_WRITE_CONCURRENCY = 8;
const RECIPIENT_SHARE_BATCH_SIZE = 2;
const DELIVERY_BATCH_SIZE = 25;
const REMINDER_DELAY_MS = 48 * 60 * 60 * 1000;
const RECAP_SEND_HOUR_UTC = 14;
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
  organizationId: string;
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
  id: string;
  viewedAt: string;
  viewerEmail: string | null;
};

type FirstViewCandidate = CountedView & {
  recordingId: string;
  ownerEmail: string;
};

type AgentView = {
  id: string;
  recordingId: string;
  agentLabel: string | null;
  firstSeenAt: string;
};

type AgentViewCandidate = AgentView & {
  ownerEmail: string;
};

type ReconciliationCursor = {
  createdAt: string;
  id: string;
};

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  mapper: (value: Value) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(RECONCILIATION_WRITE_CONCURRENCY, values.length) },
      async () => {
        while (nextIndex < values.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await mapper(values[index]);
        }
      },
    ),
  );
  return results;
}

export type TransactionalEmailStore = Pick<
  typeof transactionalEmailStore,
  | "ensureEnabledAt"
  | "enqueue"
  | "listJobs"
  | "transition"
  | "acquireSendingLease"
  | "transitionSending"
  | "updateReconciliationCursor"
  | "enqueueOrConvergeFirstImport"
>;

export interface TransactionalEmailRepository {
  listDirectShares(
    enabledAt: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<DirectShare[]>;
  listDueDirectShares(
    enabledAt: string,
    dueBefore: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<DirectShare[]>;
  listRecipientDistinctShares(
    recipient: string,
    enabledAt: string,
    limit: number,
  ): Promise<DirectShare[]>;
  listCountedNonOwnerViews(
    enabledAt: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<FirstViewCandidate[]>;
  listAgentViews(
    enabledAt: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<AgentViewCandidate[]>;
  getFirstOwnerAgentView(
    ownerEmail: string,
    enabledAt: string,
  ): Promise<AgentView | null>;
  listReadyImports(
    enabledAt: string,
    cursor: ReconciliationCursor | null,
    limit: number,
  ): Promise<RecordingState[]>;
  getRecording(recordingId: string): Promise<RecordingState | null>;
  getUserDisplayName(email: string): Promise<string | null>;
  getOrganizationBrandLogoUrl(organizationId: string): Promise<string | null>;
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
  listOwnersWithMonthlyAudience(month: string): Promise<string[]>;
  computeMonthlyRecap(
    ownerEmail: string,
    month: string,
  ): Promise<MonthlyRecap | null>;
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
  warn?: (message: string, details?: unknown) => void;
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
  const parsed = transactionalEmailRecipientSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

export function isSuppressedTransactionalRecipient(
  value: string | null | undefined,
): boolean {
  const email = normalizedEmail(value);
  // guard:allow-localhost-fallback — Suppress the retired dev identity; never use it as an owner.
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
    dueBefore?: string,
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
          dueBefore
            ? lte(schema.recordingShares.createdAt, dueBefore)
            : undefined,
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
    listDueDirectShares: (enabledAt, dueBefore, cursor, limit) =>
      selectShares(enabledAt, limit, undefined, cursor, dueBefore),
    async listRecipientDistinctShares(recipient, enabledAt, limit) {
      const distinctRecordings = await db
        .select({
          recordingId: schema.recordingShares.resourceId,
          firstSharedAt: min(schema.recordingShares.createdAt),
        })
        .from(schema.recordingShares)
        .where(
          and(
            eq(schema.recordingShares.principalType, "user"),
            ownerEmailMatches(schema.recordingShares.principalId, recipient),
            gte(schema.recordingShares.createdAt, enabledAt),
          ),
        )
        .groupBy(schema.recordingShares.resourceId)
        .orderBy(
          asc(min(schema.recordingShares.createdAt)),
          asc(schema.recordingShares.resourceId),
        )
        .limit(limit);
      const shares: DirectShare[] = [];
      for (const distinct of distinctRecordings) {
        const [share] = await db
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
              ownerEmailMatches(schema.recordingShares.principalId, recipient),
              eq(schema.recordingShares.resourceId, distinct.recordingId),
              eq(schema.recordingShares.createdAt, distinct.firstSharedAt!),
            ),
          )
          .orderBy(asc(schema.recordingShares.id))
          .limit(1);
        if (share) shares.push(share);
      }
      return shares;
    },
    async listCountedNonOwnerViews(enabledAt, cursor, limit) {
      return db
        .select({
          id: schema.recordingViews.id,
          viewedAt: schema.recordingViews.viewedAt,
          viewerEmail: schema.recordingViews.viewerEmail,
          recordingId: schema.recordingViews.recordingId,
          ownerEmail: schema.recordings.ownerEmail,
        })
        .from(schema.recordingViews)
        .innerJoin(
          schema.recordings,
          eq(schema.recordings.id, schema.recordingViews.recordingId),
        )
        .where(
          and(
            gte(schema.recordingViews.viewedAt, enabledAt),
            or(
              isNull(schema.recordingViews.viewerEmail),
              sql`lower(${schema.recordingViews.viewerEmail}) <> lower(${schema.recordings.ownerEmail})`,
            ),
            cursor
              ? or(
                  gt(schema.recordingViews.viewedAt, cursor.createdAt),
                  and(
                    eq(schema.recordingViews.viewedAt, cursor.createdAt),
                    gt(schema.recordingViews.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          asc(schema.recordingViews.viewedAt),
          asc(schema.recordingViews.id),
        )
        .limit(limit);
    },
    async listAgentViews(enabledAt, cursor, limit) {
      return db
        .select({
          id: schema.recordingAgentViews.id,
          recordingId: schema.recordingAgentViews.recordingId,
          agentLabel: schema.recordingAgentViews.agentLabel,
          firstSeenAt: schema.recordingAgentViews.firstSeenAt,
          ownerEmail: schema.recordings.ownerEmail,
        })
        .from(schema.recordingAgentViews)
        .innerJoin(
          schema.recordings,
          eq(schema.recordings.id, schema.recordingAgentViews.recordingId),
        )
        .where(
          and(
            gte(schema.recordingAgentViews.firstSeenAt, enabledAt),
            cursor
              ? or(
                  gt(schema.recordingAgentViews.firstSeenAt, cursor.createdAt),
                  and(
                    eq(
                      schema.recordingAgentViews.firstSeenAt,
                      cursor.createdAt,
                    ),
                    gt(schema.recordingAgentViews.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          asc(schema.recordingAgentViews.firstSeenAt),
          asc(schema.recordingAgentViews.id),
        )
        .limit(limit);
    },
    async getFirstOwnerAgentView(ownerEmail, enabledAt) {
      const [view] = await db
        .select({
          id: schema.recordingAgentViews.id,
          recordingId: schema.recordingAgentViews.recordingId,
          agentLabel: schema.recordingAgentViews.agentLabel,
          firstSeenAt: schema.recordingAgentViews.firstSeenAt,
        })
        .from(schema.recordingAgentViews)
        .innerJoin(
          schema.recordings,
          eq(schema.recordings.id, schema.recordingAgentViews.recordingId),
        )
        .where(
          and(
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            gte(schema.recordingAgentViews.firstSeenAt, enabledAt),
          ),
        )
        .orderBy(
          asc(schema.recordingAgentViews.firstSeenAt),
          asc(schema.recordingAgentViews.id),
        )
        .limit(1);
      return view ?? null;
    },
    async listReadyImports(enabledAt, cursor, limit) {
      return db
        .select({
          id: schema.recordings.id,
          organizationId: schema.recordings.organizationId,
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
        .where(
          and(
            eq(schema.recordings.status, "ready"),
            gte(schema.recordings.createdAt, enabledAt),
            or(
              eq(schema.recordings.sourceAppName, "Loom"),
              eq(schema.recordings.sourceAppName, "Video link"),
            ),
            cursor
              ? or(
                  gt(schema.recordings.createdAt, cursor.createdAt),
                  and(
                    eq(schema.recordings.createdAt, cursor.createdAt),
                    gt(schema.recordings.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(schema.recordings.createdAt), asc(schema.recordings.id))
        .limit(limit);
    },
    async getRecording(recordingId) {
      const [recording] = await db
        .select({
          id: schema.recordings.id,
          organizationId: schema.recordings.organizationId,
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
    async getUserDisplayName(email) {
      return (await getUserProfile(email)).name;
    },
    async getOrganizationBrandLogoUrl(organizationId) {
      const [settings] = await db
        .select({ brandLogoUrl: schema.organizationSettings.brandLogoUrl })
        .from(schema.organizationSettings)
        .where(eq(schema.organizationSettings.organizationId, organizationId))
        .limit(1);
      return settings?.brandLogoUrl?.trim() || null;
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
      const requiredIds = new Set(recordingIds);
      if (requiredIds.size !== 2) return false;
      const rows = await db
        .select({ recordingId: schema.recordingShares.resourceId })
        .from(schema.recordingShares)
        .where(
          and(
            eq(schema.recordingShares.principalType, "user"),
            ownerEmailMatches(schema.recordingShares.principalId, recipient),
            inArray(schema.recordingShares.resourceId, [...requiredIds]),
          ),
        )
        .groupBy(schema.recordingShares.resourceId);
      const sharedIds = new Set(rows.map((share) => share.recordingId));
      return (
        sharedIds.size === requiredIds.size &&
        [...requiredIds].every((recordingId) => sharedIds.has(recordingId))
      );
    },
    async recipientHasCountedView(recipient, recordingId) {
      const [view] = await db
        .select({ id: schema.recordingViews.id })
        .from(schema.recordingViews)
        .where(
          and(
            eq(schema.recordingViews.recordingId, recordingId),
            isNotNull(schema.recordingViews.viewerEmail),
            ownerEmailMatches(schema.recordingViews.viewerEmail, recipient),
          ),
        )
        .limit(1);
      return Boolean(view);
    },
    async getFirstNonOwnerCountedView(recordingId, ownerEmail) {
      const [view] = await db
        .select({
          id: schema.recordingViews.id,
          viewedAt: schema.recordingViews.viewedAt,
          viewerEmail: schema.recordingViews.viewerEmail,
        })
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
    listOwnersWithMonthlyAudience,
    computeMonthlyRecap,
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

async function reconcileShareDiscovery(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const page = await repository.listDirectShares(enabledAt, cursor, limit);
  const shares = page
    .map(normalizeShare)
    .filter((share): share is DirectShare => share !== null);
  let enqueued = 0;

  for (const recipient of new Set(shares.map((share) => share.recipient))) {
    if (await repository.recipientOwnsRecording(recipient)) continue;
    const recipientShares = (
      await repository.listRecipientDistinctShares(
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

async function reconcileDueReminders(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  now: Date,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const dueBefore = new Date(now.getTime() - REMINDER_DELAY_MS).toISOString();
  const page = await repository.listDueDirectShares(
    enabledAt,
    dueBefore,
    cursor,
    limit,
  );
  const enqueued = (
    await mapWithConcurrency(page, async (rawShare) => {
      const share = normalizeShare(rawShare);
      if (!share) return false;
      return (
        await store.enqueue(`unviewed-reminder:${share.id}`, {
          type: "unviewed-reminder",
          recipient: share.recipient,
          recordingIds: [share.recordingId],
          shareId: share.id,
          requestedBy: share.createdBy,
        })
      ).created;
    })
  ).filter(Boolean).length;
  const lastShare = page[page.length - 1];
  return {
    enqueued,
    nextCursor:
      page.length >= limit && lastShare
        ? { createdAt: lastShare.createdAt, id: lastShare.id }
        : null,
  };
}

async function reconcileFirstViews(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const page = await repository.listCountedNonOwnerViews(
    enabledAt,
    cursor,
    limit,
  );
  let enqueued = 0;
  for (const candidate of page) {
    const ownerEmail = normalizedEmail(candidate.ownerEmail);
    if (!ownerEmail || isSuppressedTransactionalRecipient(ownerEmail)) continue;
    const firstView = await repository.getFirstNonOwnerCountedView(
      candidate.recordingId,
      ownerEmail,
    );
    if (
      !firstView ||
      firstView.id !== candidate.id ||
      firstView.viewedAt < enabledAt
    ) {
      continue;
    }
    const result = await store.enqueue(`first-view:${candidate.recordingId}`, {
      type: "first-view",
      recipient: ownerEmail,
      recordingIds: [candidate.recordingId],
      requestedBy: ownerEmail,
    });
    if (result.created) enqueued += 1;
  }
  const lastView = page[page.length - 1];
  return {
    enqueued,
    nextCursor:
      page.length >= limit && lastView
        ? { createdAt: lastView.viewedAt, id: lastView.id }
        : null,
  };
}

async function reconcileFirstAgentViews(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const page = await repository.listAgentViews(enabledAt, cursor, limit);
  let enqueued = 0;
  for (const candidate of page) {
    const ownerEmail = normalizedEmail(candidate.ownerEmail);
    if (!ownerEmail || isSuppressedTransactionalRecipient(ownerEmail)) continue;
    const firstAgentView = await repository.getFirstOwnerAgentView(
      ownerEmail,
      enabledAt,
    );
    if (!firstAgentView || firstAgentView.id !== candidate.id) continue;
    const result = await store.enqueue(`first-agent-view:${ownerEmail}`, {
      type: "first-agent-view",
      recipient: ownerEmail,
      recordingIds: [candidate.recordingId],
      requestedBy: ownerEmail,
    });
    if (result.created) enqueued += 1;
  }
  const lastView = page[page.length - 1];
  return {
    enqueued,
    nextCursor:
      page.length >= limit && lastView
        ? { createdAt: lastView.firstSeenAt, id: lastView.id }
        : null,
  };
}

async function reconcileFirstImports(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  cursor: ReconciliationCursor | null,
  limit: number,
): Promise<{ enqueued: number; nextCursor: ReconciliationCursor | null }> {
  const page = await repository.listReadyImports(enabledAt, cursor, limit);
  let enqueued = 0;
  for (const recording of page) {
    const ownerEmail = normalizedEmail(recording.ownerEmail);
    if (!ownerEmail || isSuppressedTransactionalRecipient(ownerEmail)) continue;
    if (!(await repository.isFirstImport(recording, ownerEmail, enabledAt))) {
      continue;
    }
    const result = await store.enqueueOrConvergeFirstImport(
      ownerEmail,
      recording.id,
      ownerEmail,
    );
    if (result.created) enqueued += 1;
  }
  const lastImport = page[page.length - 1];
  return {
    enqueued,
    nextCursor:
      page.length >= limit && lastImport
        ? { createdAt: lastImport.createdAt, id: lastImport.id }
        : null,
  };
}

/**
 * Recaps close on the UTC month boundary but wait until `RECAP_SEND_HOUR_UTC`
 * on the 1st so they land mid-morning in the Americas rather than at midnight.
 * A month is only ever enqueued once per owner, so a late first run of the day
 * still sends rather than skipping the month.
 */
async function reconcileMonthlyRecaps(
  repository: TransactionalEmailRepository,
  store: TransactionalEmailStore,
  enabledAt: string,
  now: Date,
): Promise<number> {
  if (now.getUTCHours() < RECAP_SEND_HOUR_UTC) return 0;
  const month = previousRecapMonth(now);
  // Never recap a month that closed before transactional email was switched on.
  if (recapMonthRange(month).startAt < enabledAt) return 0;

  let enqueued = 0;
  for (const ownerEmail of await repository.listOwnersWithMonthlyAudience(
    month,
  )) {
    const recipient = normalizedEmail(ownerEmail);
    if (!recipient || isSuppressedTransactionalRecipient(recipient)) continue;
    const recap = await repository.computeMonthlyRecap(recipient, month);
    if (!recap) continue;
    const result = await store.enqueue(
      `monthly-recap:${recipient}:${month}`,
      {
        type: "monthly-recap",
        recipient,
        recordingIds: [recap.topClip.recordingId],
        requestedBy: recipient,
        month,
      },
      "awaiting_ai",
    );
    if (result.created) enqueued += 1;
  }
  return enqueued;
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
    const senderEmail =
      normalizedEmail(job.requestedBy) ??
      normalizedEmail(recordings[0].ownerEmail);
    const [senderName, brandLogoUrl] = await Promise.all([
      senderEmail ? repository.getUserDisplayName(senderEmail) : null,
      repository.getOrganizationBrandLogoUrl(recordings[0].organizationId),
    ]);
    return {
      kind: "unviewed-reminder",
      to: recipient,
      recordingId: recordings[0].id,
      title: recordings[0].title,
      senderEmail,
      senderName,
      brandLogoUrl,
    };
  }

  if (job.type === "monthly-recap") {
    // Recomputed at send time: a clip trashed after enqueue must not headline.
    if (!job.month || !job.generatedRecapCopy) return null;
    const recap = await repository.computeMonthlyRecap(recipient, job.month);
    if (!recap || recap.topClip.recordingId !== recordings[0].id) return null;
    return {
      kind: "monthly-recap",
      to: recipient,
      month: job.month,
      humanViews: recap.humanViews,
      agentSessions: recap.agentSessions,
      topClip: {
        recordingId: recap.topClip.recordingId,
        title: recap.topClip.title,
        thumbnailUrl: recap.topClip.thumbnailUrl,
        durationMs: recap.topClip.durationMs,
        recordedAt: recap.topClip.recordedAt,
        humanViews: recap.topClip.humanViews,
        agentSessions: recap.topClip.agentSessions,
      },
      copy: job.generatedRecapCopy,
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

  if (job.type === "first-agent-view") {
    if (normalizedEmail(recordings[0].ownerEmail) !== recipient) return null;
    const firstAgentView = await repository.getFirstOwnerAgentView(
      recipient,
      enabledAt,
    );
    if (!firstAgentView || firstAgentView.recordingId !== recordings[0].id) {
      return null;
    }
    return {
      kind: "first-agent-view",
      to: recipient,
      recordingId: recordings[0].id,
      title: recordings[0].title,
      // "Agent" is the agent-views fallback label, not a product name.
      agentName:
        firstAgentView.agentLabel === UNKNOWN_AGENT_LABEL
          ? null
          : firstAgentView.agentLabel,
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
    const reconciliationLimit =
      dependencies.reconciliationBatchSize ?? RECONCILIATION_BATCH_SIZE;
    const shareDiscovery = await reconcileShareDiscovery(
      repository,
      store,
      config.enabledAt,
      config.shareDiscoveryCursor ?? null,
      reconciliationLimit,
    );
    result.enqueued += shareDiscovery.enqueued;
    await store.updateReconciliationCursor(
      "shareDiscoveryCursor",
      shareDiscovery.nextCursor,
    );
    const reminders = await reconcileDueReminders(
      repository,
      store,
      config.enabledAt,
      config.reminderCursor ?? null,
      currentTime,
      reconciliationLimit,
    );
    result.enqueued += reminders.enqueued;
    await store.updateReconciliationCursor(
      "reminderCursor",
      reminders.nextCursor,
    );
    const firstViews = await reconcileFirstViews(
      repository,
      store,
      config.enabledAt,
      config.firstViewCursor ?? null,
      reconciliationLimit,
    );
    result.enqueued += firstViews.enqueued;
    await store.updateReconciliationCursor(
      "firstViewCursor",
      firstViews.nextCursor,
    );
    const firstAgentViews = await reconcileFirstAgentViews(
      repository,
      store,
      config.enabledAt,
      config.firstAgentViewCursor ?? null,
      reconciliationLimit,
    );
    result.enqueued += firstAgentViews.enqueued;
    await store.updateReconciliationCursor(
      "firstAgentViewCursor",
      firstAgentViews.nextCursor,
    );
    const firstImports = await reconcileFirstImports(
      repository,
      store,
      config.enabledAt,
      config.firstImportCursor ?? null,
      reconciliationLimit,
    );
    result.enqueued += firstImports.enqueued;
    await store.updateReconciliationCursor(
      "firstImportCursor",
      firstImports.nextCursor,
    );

    result.enqueued += await reconcileMonthlyRecaps(
      repository,
      store,
      config.enabledAt,
      currentTime,
    );

    const jobs = await store.listJobs();
    const warn = dependencies.warn ?? console.warn;
    for (const job of jobs) {
      const dispatchedAt = job.aiDispatchedAt ?? job.updatedAt;
      if (
        job.state === "ai_dispatched" &&
        currentTime.getTime() - Date.parse(dispatchedAt) >= AI_DISPATCH_STALE_MS
      ) {
        warn("[transactional-emails] AI dispatch remains unresolved", {
          logicalKey: job.logicalKey,
          aiDispatchedAt: dispatchedAt,
        });
      }
    }
    await mapWithConcurrency(
      jobs.filter(
        (job) =>
          job.state === "pending" &&
          (job.type === "first-view" ||
            job.type === "first-agent-view" ||
            job.type === "first-import" ||
            job.type === "unviewed-reminder"),
      ),
      (job) => store.transition(job.logicalKey, ["pending"], "ready"),
    );

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
        const lastError =
          candidate.lastError ?? "Maximum delivery attempts reached";
        const failed =
          candidate.state === "sending"
            ? await (async () => {
                const reclaimed = await store.acquireSendingLease(
                  candidate.logicalKey,
                  dependencies.leaseDurationMs ?? SENDING_LEASE_MS,
                );
                return reclaimed?.leaseToken
                  ? store.transitionSending(
                      candidate.logicalKey,
                      reclaimed.leaseToken,
                      "failed",
                      { lastError },
                    )
                  : null;
              })()
            : await store.transition(
                candidate.logicalKey,
                [candidate.state],
                "failed",
                { lastError },
              );
        if (failed) result.failed += 1;
        continue;
      }
      const leased = await store.acquireSendingLease(
        candidate.logicalKey,
        dependencies.leaseDurationMs ?? SENDING_LEASE_MS,
      );
      if (!leased) continue;

      const leaseToken = leased.leaseToken;
      if (!leaseToken) continue;
      const input = await makeSendInput(leased, repository, config.enabledAt);
      if (!input) {
        if (
          await store.transitionSending(
            leased.logicalKey,
            leaseToken,
            "cancelled",
          )
        ) {
          result.cancelled += 1;
        }
        continue;
      }

      try {
        await (dependencies.send ?? sendClipsTransactionalEmail)(input);
        if (
          await store.transitionSending(leased.logicalKey, leaseToken, "sent")
        ) {
          result.sent += 1;
        }
      } catch (error) {
        const message = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 4_000);
        if (leased.attempts >= maxAttempts) {
          if (
            await store.transitionSending(
              leased.logicalKey,
              leaseToken,
              "failed",
              { lastError: message },
            )
          ) {
            result.failed += 1;
          }
        } else if (
          await store.transitionSending(
            leased.logicalKey,
            leaseToken,
            "ready",
            { lastError: message },
          )
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
