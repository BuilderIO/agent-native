import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, gte, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  AI_DISPATCH_STALE_MS,
  isAiBackedType,
  transactionalEmailStore,
  type TransactionalEmailJob,
} from "../server/lib/transactional-email-store.js";

const MAX_CLAIMS = 10;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 600;
export const MAX_TRANSCRIPT_EXCERPT_LENGTH = 1_200;

export type TransactionalEmailContextPacket = {
  recordingId: string;
  title: string;
  description: string;
  senderEmail: string;
  transcriptExcerpt: string;
};

export type ClaimedTransactionalEmailAiRequest = {
  kind: "two-clips";
  jobId: string;
  logicalKey: string;
  contextPackets: [
    TransactionalEmailContextPacket,
    TransactionalEmailContextPacket,
  ];
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function boundedText(value: string | null | undefined, limit: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

async function filterFederatedRecordingAccess<
  T extends {
    id: string;
    visibility?: string | null;
  },
>(rows: T[], accessCache: Map<string, Promise<boolean>>): Promise<T[]> {
  const filtered: Array<T | null> = await Promise.all(
    rows.map(async (row): Promise<T | null> => {
      if (row.visibility !== "org") return row;

      let access = accessCache.get(row.id);
      if (!access) {
        access = resolveAccess("recording", row.id, undefined, {
          skipResourceBody: true,
        }).then(Boolean);
        accessCache.set(row.id, access);
      }
      return (await access) ? row : null;
    }),
  );
  return filtered.filter((row): row is T => row !== null);
}

async function claimantMayClaim(
  job: TransactionalEmailJob,
  claimantEmail: string,
  accessCache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  if (normalizeEmail(job.recipient) === claimantEmail) return true;
  if (normalizeEmail(job.requestedBy) !== claimantEmail) return false;

  const db = getDb();
  const [accessibleCandidates, directShares, countedViews] = await Promise.all([
    db
      .select({
        id: schema.recordings.id,
        ownerEmail: schema.recordings.ownerEmail,
        visibility: schema.recordings.visibility,
      })
      .from(schema.recordings)
      .where(
        and(
          inArray(schema.recordings.id, job.recordingIds),
          or(
            and(
              ne(schema.recordings.visibility, "org"),
              accessFilter(
                schema.recordings,
                schema.recordingShares,
                undefined,
                "viewer",
                { includePublic: true },
              ),
            ),
            eq(schema.recordings.visibility, "org"),
          ),
        ),
      ),
    db
      .select({ recordingId: schema.recordingShares.resourceId })
      .from(schema.recordingShares)
      .where(
        and(
          eq(schema.recordingShares.principalType, "user"),
          ownerEmailMatches(schema.recordingShares.principalId, claimantEmail),
          inArray(schema.recordingShares.resourceId, job.recordingIds),
        ),
      ),
    db
      .select({ recordingId: schema.recordingViewers.recordingId })
      .from(schema.recordingViewers)
      .where(
        and(
          ownerEmailMatches(schema.recordingViewers.viewerEmail, claimantEmail),
          eq(schema.recordingViewers.countedView, true),
          inArray(schema.recordingViewers.recordingId, job.recordingIds),
        ),
      ),
  ]);
  const accessibleRows = await filterFederatedRecordingAccess(
    accessibleCandidates,
    accessCache,
  );
  const accessibleIds = new Set(accessibleRows.map((row) => row.id));
  const directlyRelatedIds = new Set([
    ...accessibleRows.flatMap((row) =>
      normalizeEmail(row.ownerEmail) === claimantEmail ? [row.id] : [],
    ),
    ...directShares.map((share) => share.recordingId),
    ...countedViews.map((view) => view.recordingId),
  ]);
  return job.recordingIds.every(
    (recordingId) =>
      accessibleIds.has(recordingId) && directlyRelatedIds.has(recordingId),
  );
}

async function loadContextPackets(
  job: TransactionalEmailJob,
  enabledAt: string,
  accessCache: Map<string, Promise<boolean>>,
): Promise<
  [TransactionalEmailContextPacket, TransactionalEmailContextPacket] | null
> {
  if (job.type !== "two-clips" || job.recordingIds.length !== 2) return null;

  const db = getDb();
  const [recordingCandidates, transcripts, shares] = await Promise.all([
    db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        description: schema.recordings.description,
        visibility: schema.recordings.visibility,
      })
      .from(schema.recordings)
      .where(
        and(
          inArray(schema.recordings.id, job.recordingIds),
          or(
            and(
              ne(schema.recordings.visibility, "org"),
              accessFilter(
                schema.recordings,
                schema.recordingShares,
                undefined,
                "viewer",
                { includePublic: true },
              ),
            ),
            eq(schema.recordings.visibility, "org"),
          ),
        ),
      ),
    db
      .select({
        recordingId: schema.recordingTranscripts.recordingId,
        fullText: schema.recordingTranscripts.fullText,
      })
      .from(schema.recordingTranscripts)
      .where(
        inArray(schema.recordingTranscripts.recordingId, job.recordingIds),
      ),
    db
      .select({
        id: schema.recordingShares.id,
        recordingId: schema.recordingShares.resourceId,
        principalId: schema.recordingShares.principalId,
        createdBy: schema.recordingShares.createdBy,
        createdAt: schema.recordingShares.createdAt,
      })
      .from(schema.recordingShares)
      .where(
        and(
          eq(schema.recordingShares.principalType, "user"),
          inArray(schema.recordingShares.resourceId, job.recordingIds),
          gte(schema.recordingShares.createdAt, enabledAt),
        ),
      ),
  ]);
  const recordings = await filterFederatedRecordingAccess(
    recordingCandidates,
    accessCache,
  );

  const recordingById = new Map(recordings.map((row) => [row.id, row]));
  const transcriptById = new Map(
    transcripts.map((row) => [row.recordingId, row.fullText]),
  );
  const recipient = normalizeEmail(job.recipient);
  const senderByRecordingId = new Map<string, string>();
  for (const share of shares
    .filter(
      (row) =>
        normalizeEmail(row.principalId) === recipient &&
        row.createdAt >= enabledAt,
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )) {
    if (!senderByRecordingId.has(share.recordingId)) {
      senderByRecordingId.set(
        share.recordingId,
        normalizeEmail(share.createdBy),
      );
    }
  }

  const packets = job.recordingIds.map((recordingId) => {
    const recording = recordingById.get(recordingId);
    const senderEmail = senderByRecordingId.get(recordingId);
    if (!recording || !senderEmail) return null;
    return {
      recordingId,
      title: boundedText(recording.title, MAX_TITLE_LENGTH),
      description: boundedText(recording.description, MAX_DESCRIPTION_LENGTH),
      senderEmail,
      transcriptExcerpt: boundedText(
        transcriptById.get(recordingId),
        MAX_TRANSCRIPT_EXCERPT_LENGTH,
      ),
    };
  });

  return packets.length === 2 && packets[0] && packets[1]
    ? [packets[0], packets[1]]
    : null;
}

export async function claimTransactionalEmailAiRequests(
  claimantEmail: string,
  limit = MAX_CLAIMS,
): Promise<{ requests: ClaimedTransactionalEmailAiRequest[] }> {
  const claimant = normalizeEmail(claimantEmail);
  const claimLimit = Math.min(Math.max(limit, 1), MAX_CLAIMS);
  const config = await transactionalEmailStore.readConfig();
  if (!config) return { requests: [] };
  const staleBefore = new Date(Date.now() - AI_DISPATCH_STALE_MS);
  const candidates = (
    await transactionalEmailStore.listJobs(["awaiting_ai", "ai_dispatched"])
  ).filter(
    (job) =>
      isAiBackedType(job.type) &&
      (job.state === "awaiting_ai" ||
        (job.state === "ai_dispatched" &&
          Date.parse(job.aiDispatchedAt ?? job.updatedAt) <=
            staleBefore.getTime())) &&
      job.recordingIds.length === 2,
  );
  const requests: ClaimedTransactionalEmailAiRequest[] = [];
  const accessCache = new Map<string, Promise<boolean>>();

  for (const candidate of candidates) {
    if (requests.length >= claimLimit) break;
    if (!(await claimantMayClaim(candidate, claimant, accessCache))) continue;
    const contextPackets = await loadContextPackets(
      candidate,
      config.enabledAt,
      accessCache,
    );
    if (!contextPackets) continue;
    const claimed =
      candidate.state === "awaiting_ai"
        ? await transactionalEmailStore.claimAwaitingAi(
            candidate.logicalKey,
            claimant,
          )
        : await transactionalEmailStore.reclaimStaleAiDispatch(
            candidate.logicalKey,
            claimant,
            staleBefore,
          );
    if (!claimed) continue;
    requests.push({
      kind: "two-clips",
      jobId: claimed.logicalKey,
      logicalKey: claimed.logicalKey,
      contextPackets,
    });
  }

  return { requests };
}

export default defineAction({
  description:
    "Claim bounded two-Clip transactional email summary work for the signed-in Clips UI.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => claimTransactionalEmailAiRequests(getCurrentOwnerEmail()),
});
