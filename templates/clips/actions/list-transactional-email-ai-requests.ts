import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
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

async function claimantMayClaim(
  job: TransactionalEmailJob,
  claimantEmail: string,
): Promise<boolean> {
  if (normalizeEmail(job.recipient) === claimantEmail) return true;
  if (normalizeEmail(job.requestedBy) !== claimantEmail) return false;

  const access = await Promise.all(
    job.recordingIds.map((recordingId) =>
      resolveAccess("recording", recordingId),
    ),
  );
  return access.every(Boolean);
}

async function loadContextPackets(
  job: TransactionalEmailJob,
  enabledAt: string,
): Promise<
  [TransactionalEmailContextPacket, TransactionalEmailContextPacket] | null
> {
  if (job.type !== "two-clips" || job.recordingIds.length !== 2) return null;

  const db = getDb();
  const [recordings, transcripts, shares] = await Promise.all([
    db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        description: schema.recordings.description,
      })
      .from(schema.recordings)
      .where(
        and(
          inArray(schema.recordings.id, job.recordingIds),
          accessFilter(schema.recordings, schema.recordingShares),
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
  const candidates = (await transactionalEmailStore.listJobs()).filter(
    (job) =>
      job.type === "two-clips" &&
      job.state === "awaiting_ai" &&
      job.recordingIds.length === 2,
  );
  const requests: ClaimedTransactionalEmailAiRequest[] = [];

  for (const candidate of candidates) {
    if (requests.length >= claimLimit) break;
    if (!(await claimantMayClaim(candidate, claimant))) continue;
    const contextPackets = await loadContextPackets(
      candidate,
      config.enabledAt,
    );
    if (!contextPackets) continue;
    const claimed = await transactionalEmailStore.claimAwaitingAi(
      candidate.logicalKey,
      claimant,
    );
    if (!claimed) continue;
    requests.push({
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
