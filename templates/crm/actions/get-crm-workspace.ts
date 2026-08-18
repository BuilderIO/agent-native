import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

/**
 * Everything here is derived from the auth session — there is no per-user CRM
 * configuration to author, and none should be introduced. "Who am I in this
 * CRM" is answered from the mirrored owner attribution on the records the caller
 * already owns.
 */

/** Records scanned to build the book of business before the answer is partial. */
const MAX_BOOK_SCAN = 500;
const MAX_TASK_SCAN = 200;
const MAX_QUEUE_SCAN = 100;

export type CrmOwnerStatus =
  | "resolved"
  | "unmapped"
  | "ambiguous"
  | "unreadable"
  | "not-applicable";

interface OwnerError {
  code: "crm-owner-ambiguous" | "crm-owner-connection-unhealthy";
  message: string;
  connectionId?: string;
}

interface OwnedRecord {
  id: string;
  displayName: string;
  objectType: string;
  kind: string;
  stage: string | null;
  amount: number | null;
  currencyCode: string | null;
  closeDate: string | null;
  connectionId: string;
  ownerRemoteId: string | null;
  ownerName: string | null;
  nextContactAt: string | null;
  updatedAt: string;
}

interface ConnectionHealth {
  id: string;
  provider: string;
  label: string;
  mode: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/**
 * Resolve the caller's provider owner identity from their own mirrored records.
 *
 * The four non-resolved outcomes are deliberately DIFFERENT values. "No provider
 * connection", "connected but nothing attributes you to an owner", "the mirror
 * is stale because a connection is broken", and "you appear under two owner ids"
 * all render as an empty owner slot if they are flattened, and the third one is
 * the dangerous case: it would let a broken connection look exactly like an
 * empty book of business.
 */
function resolveWorkspaceOwner(input: {
  connections: ConnectionHealth[];
  records: OwnedRecord[];
}): {
  ownerStatus: CrmOwnerStatus;
  owner: {
    connectionId: string;
    provider: string;
    ownerRemoteId: string;
    ownerName: string | null;
    recordCount: number;
  } | null;
  ownerError?: OwnerError;
} {
  const providerConnections = input.connections.filter(
    (connection) => connection.provider !== "native",
  );
  if (!providerConnections.length) {
    return { ownerStatus: "not-applicable", owner: null };
  }

  const unhealthy = providerConnections.find(
    (connection) =>
      connection.status === "error" || connection.status === "disconnected",
  );
  if (unhealthy) {
    return {
      ownerStatus: "unreadable",
      owner: null,
      ownerError: {
        code: "crm-owner-connection-unhealthy",
        message: `Connection "${unhealthy.label}" is ${unhealthy.status}${
          unhealthy.lastError ? `: ${unhealthy.lastError}` : ""
        }. Your provider owner identity cannot be determined from a stale mirror — reconnect it before treating this book of business as complete.`,
        connectionId: unhealthy.id,
      },
    };
  }

  const byOwner = new Map<
    string,
    {
      connectionId: string;
      ownerRemoteId: string;
      ownerName: string | null;
      count: number;
    }
  >();
  for (const record of input.records) {
    if (!record.ownerRemoteId) continue;
    const key = `${record.connectionId}:${record.ownerRemoteId}`;
    const bucket = byOwner.get(key) ?? {
      connectionId: record.connectionId,
      ownerRemoteId: record.ownerRemoteId,
      ownerName: record.ownerName,
      count: 0,
    };
    bucket.count += 1;
    byOwner.set(key, bucket);
  }

  const owners = [...byOwner.values()].sort((a, b) => b.count - a.count);
  if (!owners.length) {
    return { ownerStatus: "unmapped", owner: null };
  }
  if (owners.length > 1) {
    return {
      ownerStatus: "ambiguous",
      owner: null,
      ownerError: {
        code: "crm-owner-ambiguous",
        message: `Your records are attributed to ${owners.length} different provider owner ids (${owners
          .map((owner) => owner.ownerRemoteId)
          .join(
            ", ",
          )}). Pick the right one in the provider before relying on owner-scoped work.`,
      },
    };
  }

  const [owner] = owners;
  return {
    ownerStatus: "resolved",
    owner: {
      connectionId: owner.connectionId,
      provider:
        providerConnections.find(
          (connection) => connection.id === owner.connectionId,
        )?.provider ?? "custom",
      ownerRemoteId: owner.ownerRemoteId,
      ownerName: owner.ownerName,
      recordCount: owner.count,
    },
  };
}

function bucketTaskDue(
  dueAt: string | null,
  now: number,
): "overdue" | "today" | "upcoming" | "undated" {
  if (!dueAt) return "undated";
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "undated";
  if (due < now) return "overdue";
  return due - now <= 24 * 60 * 60 * 1000 ? "today" : "upcoming";
}

export default defineAction({
  description:
    "One-call orientation for the caller: who they are, their provider owner identity, their book of business by stage, follow-up tasks due, pending write proposals, unreviewed signals, and connection health. Everything is derived from the signed-in session with no setup. Call this first when starting CRM work. A provider owner that cannot be determined comes back as ownerStatus plus ownerError — never as an empty book.",
  schema: z.object({
    bookLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("How many of the caller's records to list in full."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx?: ActionRunContext) => {
    const scope = requireCrmScope(ctx);
    const db = getDb();
    const now = Date.now();

    const connections: ConnectionHealth[] = await db
      .select({
        id: schema.crmConnections.id,
        provider: schema.crmConnections.provider,
        label: schema.crmConnections.label,
        mode: schema.crmConnections.mode,
        status: schema.crmConnections.status,
        lastSyncedAt: schema.crmConnections.lastSyncedAt,
        lastError: schema.crmConnections.lastError,
      })
      .from(schema.crmConnections)
      .where(accessFilter(schema.crmConnections, schema.crmConnectionShares))
      .limit(MAX_QUEUE_SCAN);

    // The book of business is what the caller OWNS, not everything they can
    // see — a shared org-wide record is somebody else's work.
    const records: OwnedRecord[] = await db
      .select({
        id: schema.crmRecords.id,
        displayName: schema.crmRecords.displayName,
        objectType: schema.crmRecords.objectType,
        kind: schema.crmRecords.kind,
        stage: schema.crmRecords.stage,
        amount: schema.crmRecords.amount,
        currencyCode: schema.crmRecords.currencyCode,
        closeDate: schema.crmRecords.closeDate,
        connectionId: schema.crmRecords.connectionId,
        ownerRemoteId: schema.crmRecords.ownerRemoteId,
        ownerName: schema.crmRecords.ownerName,
        nextContactAt: schema.crmRecords.nextContactAt,
        updatedAt: schema.crmRecords.updatedAt,
      })
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.ownerEmail, scope.ownerEmail),
          eq(schema.crmRecords.tombstone, false),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      )
      .orderBy(desc(schema.crmRecords.updatedAt))
      .limit(MAX_BOOK_SCAN + 1);

    // A truncated scan is not a completed one: the counts below would be a
    // confident understatement, so say so instead of rounding it off.
    const bookComplete = records.length <= MAX_BOOK_SCAN;
    const scanned = bookComplete ? records : records.slice(0, MAX_BOOK_SCAN);

    const byStage: Record<string, { records: number; amount: number }> = {};
    const byKind: Record<string, number> = {};
    for (const record of scanned) {
      const stage = record.stage ?? "(unstaged)";
      const bucket = byStage[stage] ?? { records: 0, amount: 0 };
      bucket.records += 1;
      if (record.kind === "opportunity" && typeof record.amount === "number") {
        bucket.amount += record.amount;
      }
      byStage[stage] = bucket;
      byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    }

    const taskRows = await db
      .select({
        id: schema.crmTasks.id,
        recordId: schema.crmTasks.recordId,
        title: schema.crmTasks.title,
        dueAt: schema.crmTasks.dueAt,
        assignedTo: schema.crmTasks.assignedTo,
      })
      .from(schema.crmTasks)
      .where(
        and(
          eq(schema.crmTasks.status, "open"),
          accessFilter(schema.crmTasks, schema.crmTaskShares),
        ),
      )
      .orderBy(desc(schema.crmTasks.updatedAt))
      .limit(MAX_TASK_SCAN);
    const taskCounts = { overdue: 0, today: 0, upcoming: 0, undated: 0 };
    for (const task of taskRows) {
      taskCounts[bucketTaskDue(task.dueAt, now)] += 1;
    }

    const proposals = await db
      .select({ id: schema.crmMutations.id })
      .from(schema.crmMutations)
      .where(
        and(
          eq(schema.crmMutations.status, "pending"),
          accessFilter(schema.crmMutations, schema.crmMutationShares),
        ),
      )
      .limit(MAX_QUEUE_SCAN);

    const signals = await db
      .select({ id: schema.crmSignals.id })
      .from(schema.crmSignals)
      .where(
        and(
          eq(schema.crmSignals.reviewStatus, "unreviewed"),
          accessFilter(schema.crmSignals, schema.crmSignalShares),
        ),
      )
      .limit(MAX_QUEUE_SCAN);

    const ownerResolution = resolveWorkspaceOwner({
      connections,
      records: scanned,
    });

    return {
      user: {
        email: scope.ownerEmail,
        orgId: scope.orgId,
        visibility: scope.visibility,
      },
      ...ownerResolution,
      book: {
        recordCount: scanned.length,
        complete: bookComplete,
        scanLimit: MAX_BOOK_SCAN,
        byStage,
        byKind,
        needsAttention: scanned
          .filter(
            (record) =>
              record.nextContactAt !== null &&
              Date.parse(record.nextContactAt) <= now,
          )
          .slice(0, args.bookLimit)
          .map((record) => ({
            id: record.id,
            displayName: record.displayName,
            stage: record.stage,
            nextContactAt: record.nextContactAt,
          })),
        records: scanned.slice(0, args.bookLimit).map((record) => ({
          id: record.id,
          displayName: record.displayName,
          objectType: record.objectType,
          kind: record.kind,
          stage: record.stage,
          amount: record.amount,
          currencyCode: record.currencyCode,
          closeDate: record.closeDate,
          updatedAt: record.updatedAt,
        })),
      },
      tasks: {
        open: taskRows.length,
        complete: taskRows.length < MAX_TASK_SCAN,
        ...taskCounts,
        next: taskRows
          .filter((task) => task.dueAt !== null)
          .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
          .slice(0, 5),
      },
      proposals: {
        pending: proposals.length,
        complete: proposals.length < MAX_QUEUE_SCAN,
      },
      signals: {
        unreviewed: signals.length,
        complete: signals.length < MAX_QUEUE_SCAN,
      },
      connections,
    };
  },
});
