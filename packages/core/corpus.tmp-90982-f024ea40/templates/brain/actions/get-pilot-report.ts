import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleSource,
  parseJson,
  safeCitationUrl,
  serializeSource,
} from "../server/lib/brain.js";
import {
  buildSnippet,
  redactSensitiveText,
  sourceUrlFromMetadata,
} from "../server/lib/search.js";
import type { BrainEvidence } from "../shared/types.js";

const CAPTURE_STATUSES = [
  "queued",
  "distilling",
  "distilled",
  "ignored",
] as const;
const QUEUE_STATUSES = ["queued", "processing", "done", "failed"] as const;
const KNOWLEDGE_STATUSES = [
  "published",
  "redacted",
  "draft",
  "archived",
] as const;
const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;

const RECENT_LIMIT = 8;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const DEFAULT_TRUST_LANE_TARGET = "#dev-fusion";

type StatusCount<TStatus extends string> = Record<TStatus, number> & {
  total: number;
  other: number;
};

function countByStatus<TStatus extends string>(
  rows: Array<{ status: string }>,
  statuses: readonly TStatus[],
): StatusCount<TStatus> {
  const counts = Object.fromEntries(
    statuses.map((status) => [status, 0]),
  ) as StatusCount<TStatus>;
  counts.total = rows.length;
  counts.other = 0;
  const known = new Set<string>(statuses);
  const mutableCounts = counts as Record<string, number>;
  for (const row of rows) {
    if (known.has(row.status)) {
      mutableCounts[row.status] = (mutableCounts[row.status] ?? 0) + 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}

function cleanPreview(value: string | null | undefined, maxLength = 240) {
  const snippet = buildSnippet(value ?? "", [], maxLength);
  return redactSensitiveText(snippet).replace(/\s+/g, " ").trim();
}

function evidenceFromJson(value: string) {
  return parseJson<BrainEvidence[]>(value, []);
}

function firstCitation(evidenceJson: string) {
  const evidence = evidenceFromJson(evidenceJson);
  return (
    evidence.find((item) => item.sourceUrl ?? item.url) ?? evidence[0] ?? null
  );
}

function serializeCitation(item: BrainEvidence | null) {
  if (!item) return null;
  const sourceUrl = safeCitationUrl(item.sourceUrl ?? item.url);
  return {
    captureId: item.captureId,
    captureTitle: item.captureTitle
      ? redactSensitiveText(item.captureTitle)
      : item.captureTitle,
    quote: item.quote ? cleanPreview(item.quote, 180) : item.quote,
    note: item.note ? cleanPreview(item.note, 160) : item.note,
    sourceUrl,
    timestampMs: item.timestampMs,
  };
}

function redactOptionalText(value: string | null | undefined) {
  return value ? redactSensitiveText(value) : value;
}

function sourceUrlFromEvidence(evidenceJson: string) {
  const citation = firstCitation(evidenceJson);
  return safeCitationUrl(citation?.sourceUrl ?? citation?.url);
}

function isPastIso(value: string | null | undefined, nowMs: number) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function distillationQueueStaleCounts(
  rows: Array<{ status: string; runAfter: string | null; updatedAt: string }>,
) {
  const nowMs = Date.now();
  const processingCutoffMs = nowMs - STALE_PROCESSING_MS;
  let processing = 0;
  let overdueQueued = 0;

  for (const row of rows) {
    if (row.status === "processing") {
      const updatedMs = Date.parse(row.updatedAt);
      if (Number.isFinite(updatedMs) && updatedMs <= processingCutoffMs) {
        processing += 1;
      }
    }
    if (row.status === "queued" && isPastIso(row.runAfter, nowMs)) {
      overdueQueued += 1;
    }
  }

  return {
    total: processing + overdueQueued,
    processing,
    overdueQueued,
  };
}

function buildPrivacyNotes(args: {
  sourceProvider: string;
  captureCounts: StatusCount<(typeof CAPTURE_STATUSES)[number]>;
  knowledgeCounts: StatusCount<(typeof KNOWLEDGE_STATUSES)[number]>;
  queueCounts: StatusCount<(typeof QUEUE_STATUSES)[number]>;
  staleQueue: ReturnType<typeof distillationQueueStaleCounts>;
}) {
  const notes = [
    "This report is scoped to one accessible Brain source.",
    "Raw capture content is not returned; capture previews and evidence quotes are short and redacted.",
  ];
  if (args.sourceProvider === "slack") {
    notes.push(
      "Slack DMs and MPIMs are excluded by the connector; only explicitly allow-listed channels are eligible.",
    );
  }
  if (args.captureCounts.ignored > 0) {
    notes.push(
      `${args.captureCounts.ignored} capture(s) are marked ignored and should stay out of distillation.`,
    );
  }
  if (args.knowledgeCounts.redacted > 0) {
    notes.push(
      `${args.knowledgeCounts.redacted} knowledge item(s) are marked redacted and need privacy review before publication.`,
    );
  }
  if (args.queueCounts.failed > 0) {
    notes.push(
      `${args.queueCounts.failed} distillation queue item(s) failed; errors are summarized without raw capture content.`,
    );
  }
  if (args.staleQueue.total > 0) {
    notes.push(
      `${args.staleQueue.total} distillation queue item(s) are stale or overdue and may need a retry.`,
    );
  }
  return notes;
}

function buildRecommendedNextSteps(args: {
  sourceStatus: string;
  sourceLastError: string | null;
  latestSyncStatus: string | null;
  captureCounts: StatusCount<(typeof CAPTURE_STATUSES)[number]>;
  knowledgeCounts: StatusCount<(typeof KNOWLEDGE_STATUSES)[number]>;
  proposalCounts: StatusCount<(typeof PROPOSAL_STATUSES)[number]>;
  queueCounts: StatusCount<(typeof QUEUE_STATUSES)[number]>;
  staleQueue: ReturnType<typeof distillationQueueStaleCounts>;
}) {
  const steps: string[] = [];

  if (
    args.sourceStatus === "error" ||
    args.sourceLastError ||
    args.latestSyncStatus === "error"
  ) {
    steps.push("Fix the source error, then rerun a bounded pilot sync.");
  }
  if (!args.latestSyncStatus) {
    steps.push("Run an initial pilot sync so this source has a baseline run.");
  }
  if (args.latestSyncStatus === "running") {
    steps.push(
      "Wait for the active sync run to finish before judging coverage.",
    );
  }
  if (args.captureCounts.queued > 0 || args.captureCounts.distilling > 0) {
    steps.push(
      "Review queued captures and distill only durable company knowledge.",
    );
  }
  if (
    args.queueCounts.queued > 0 ||
    args.queueCounts.processing > 0 ||
    args.staleQueue.total > 0
  ) {
    steps.push("Process or retry outstanding distillation queue items.");
  }
  if (args.proposalCounts.pending > 0) {
    steps.push(
      "Approve or reject pending proposals before broadening sync scope.",
    );
  }
  if (args.knowledgeCounts.redacted > 0) {
    steps.push("Review redacted knowledge entries before publishing them.");
  }
  if (
    args.knowledgeCounts.published === 0 &&
    args.captureCounts.distilled + args.captureCounts.queued > 0
  ) {
    steps.push(
      "Promote the first high-confidence distilled items to published knowledge.",
    );
  }
  if (!steps.length) {
    steps.push(
      "Pilot looks ready for a narrow regular sync; keep the source allow-list explicit and monitor the next run.",
    );
  }

  return steps;
}

export type PilotTrustLaneStatus =
  | "blocked"
  | "ready-to-sample"
  | "needs-distillation"
  | "needs-review"
  | "needs-eval"
  | "ready-to-expand";

export interface PilotTrustLaneInput {
  targetChannel?: string;
  sourceProvider: string;
  latestSyncStatus: string | null;
  captureCounts: StatusCount<(typeof CAPTURE_STATUSES)[number]>;
  knowledgeCounts: StatusCount<(typeof KNOWLEDGE_STATUSES)[number]>;
  proposalCounts: StatusCount<(typeof PROPOSAL_STATUSES)[number]>;
  queueCounts: StatusCount<(typeof QUEUE_STATUSES)[number]>;
  staleQueue: ReturnType<typeof distillationQueueStaleCounts>;
}

function trustLaneStatus(args: PilotTrustLaneInput): PilotTrustLaneStatus {
  if (args.sourceProvider !== "slack" || args.latestSyncStatus === "error") {
    return "blocked";
  }
  if (!args.latestSyncStatus) return "ready-to-sample";
  if (
    args.captureCounts.queued > 0 ||
    args.captureCounts.distilling > 0 ||
    args.queueCounts.queued > 0 ||
    args.queueCounts.processing > 0 ||
    args.staleQueue.total > 0
  ) {
    return "needs-distillation";
  }
  if (args.proposalCounts.pending > 0) return "needs-review";
  if (args.knowledgeCounts.published === 0) return "needs-eval";
  return "ready-to-expand";
}

function trustLaneLabel(status: PilotTrustLaneStatus) {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "ready-to-sample":
      return "Ready to sample";
    case "needs-distillation":
      return "Needs distillation";
    case "needs-review":
      return "Needs review";
    case "needs-eval":
      return "Needs eval";
    case "ready-to-expand":
      return "Ready to expand";
  }
}

function trustLaneSummary(status: PilotTrustLaneStatus, targetChannel: string) {
  switch (status) {
    case "blocked":
      return `${targetChannel} pilot is blocked until the Slack source and latest sync are healthy.`;
    case "ready-to-sample":
      return `${targetChannel} is ready for one bounded Slack pilot sample.`;
    case "needs-distillation":
      return `${targetChannel} has imported material that needs distillation or queue cleanup before trust review.`;
    case "needs-review":
      return `${targetChannel} has pending proposed memories to approve or reject.`;
    case "needs-eval":
      return `${targetChannel} needs retrieval eval confirmation before broadening sync.`;
    case "ready-to-expand":
      return `${targetChannel} has cited published knowledge and is ready for a narrow expansion.`;
  }
}

function syncStatusLabel(status: string) {
  return status
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function checkStatus(ok: boolean, pending = false) {
  if (ok) return "ok" as const;
  return pending ? ("pending" as const) : ("attention" as const);
}

export function buildPilotTrustLane(args: PilotTrustLaneInput) {
  const targetChannel = args.targetChannel ?? DEFAULT_TRUST_LANE_TARGET;
  const status = trustLaneStatus(args);
  const hasSync = Boolean(args.latestSyncStatus);
  const hasQueueWork =
    args.captureCounts.queued > 0 ||
    args.captureCounts.distilling > 0 ||
    args.queueCounts.queued > 0 ||
    args.queueCounts.processing > 0 ||
    args.staleQueue.total > 0;
  const pendingReview = args.proposalCounts.pending > 0;
  const hasPublishedKnowledge = args.knowledgeCounts.published > 0;

  return {
    targetChannel,
    status,
    label: trustLaneLabel(status),
    summary: trustLaneSummary(status, targetChannel),
    checks: [
      {
        id: "sample",
        label: "Bounded sample",
        status: checkStatus(hasSync, status === "ready-to-sample"),
        detail: hasSync
          ? `Latest sync ${syncStatusLabel(args.latestSyncStatus ?? "unknown")}.`
          : "Run a safe pilot sample before reviewing retrieval trust.",
      },
      {
        id: "distillation",
        label: "Distillation clear",
        status: checkStatus(!hasQueueWork, hasSync),
        detail: hasQueueWork
          ? `${args.captureCounts.queued + args.captureCounts.distilling + args.queueCounts.queued + args.queueCounts.processing + args.staleQueue.total} item(s) need distillation attention.`
          : "No queued, processing, or stale distillation work is blocking review.",
      },
      {
        id: "review",
        label: "Review queue",
        status: checkStatus(!pendingReview, hasSync),
        detail: pendingReview
          ? `${args.proposalCounts.pending} proposal(s) are waiting for review.`
          : "No pending proposals from this source.",
      },
      {
        id: "retrieval",
        label: "Retrieval trust",
        status: checkStatus(hasPublishedKnowledge, hasSync && !hasQueueWork),
        detail: hasPublishedKnowledge
          ? `${args.knowledgeCounts.published} published item(s) are available for cited answers.`
          : "Run the retrieval eval after durable items are published.",
      },
    ],
    nextActions:
      status === "ready-to-sample"
        ? [
            {
              action: "run-slack-pilot",
              args: { readHistory: true },
              why: "Import one tiny capped sample before distillation.",
            },
          ]
        : status === "needs-distillation"
          ? [
              {
                action: "list-captures",
                args: { status: "queued" },
                why: "Review imported captures without raw bodies first.",
              },
              {
                action: "enqueue-captures-distillation",
                args: { priority: 60 },
                why: "Queue only durable company context for extraction.",
              },
            ]
          : status === "needs-review"
            ? [
                {
                  action: "list-proposals",
                  args: { status: "pending" },
                  why: "Approve or reject proposed company memories.",
                },
              ]
            : status === "needs-eval"
              ? [
                  {
                    action: "run-retrieval-eval",
                    args: { seedIfMissing: false },
                    why: "Verify real workspace data before fallback seeding.",
                  },
                ]
              : status === "ready-to-expand"
                ? [
                    {
                      action: "get-pilot-report",
                      args: {},
                      why: "Recheck this report after the next bounded sync.",
                    },
                  ]
                : [
                    {
                      action: "test-slack-connection",
                      args: {},
                      why: "Fix credentials or channel validation before sampling.",
                    },
                  ],
    evalQuestions: [
      `Why did project settings revert in ${targetChannel}?`,
      `What was concluded about the TanStack compromise in ${targetChannel}?`,
      `What should Brain say when ${targetChannel} has no cited support?`,
    ],
  };
}

export default defineAction({
  description:
    "Return a structured pilot quality report for one Brain source, including sync health, counts, privacy notes, and recommended next steps.",
  schema: z.object({
    sourceId: z.string().min(1),
    targetChannel: z
      .string()
      .default(DEFAULT_TRUST_LANE_TARGET)
      .describe("Pilot trust lane target, usually #dev-fusion."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ sourceId, targetChannel }) => {
    const access = await getAccessibleSource(sourceId);
    const db = getDb();

    const [latestSyncRun] = await db
      .select()
      .from(schema.brainSyncRuns)
      .where(eq(schema.brainSyncRuns.sourceId, sourceId))
      .orderBy(desc(schema.brainSyncRuns.startedAt))
      .limit(1);

    const captureRows = await db
      .select({
        id: schema.brainRawCaptures.id,
        status: schema.brainRawCaptures.status,
      })
      .from(schema.brainRawCaptures)
      .where(eq(schema.brainRawCaptures.sourceId, sourceId));

    const recentCaptureRows = await db
      .select({
        id: schema.brainRawCaptures.id,
        title: schema.brainRawCaptures.title,
        kind: schema.brainRawCaptures.kind,
        status: schema.brainRawCaptures.status,
        metadataJson: schema.brainRawCaptures.metadataJson,
        content: schema.brainRawCaptures.content,
        capturedAt: schema.brainRawCaptures.capturedAt,
        createdAt: schema.brainRawCaptures.createdAt,
        updatedAt: schema.brainRawCaptures.updatedAt,
      })
      .from(schema.brainRawCaptures)
      .where(eq(schema.brainRawCaptures.sourceId, sourceId))
      .orderBy(desc(schema.brainRawCaptures.capturedAt))
      .limit(RECENT_LIMIT);

    const captureIds = captureRows.map((capture) => capture.id);
    const queueSourceFilter = captureIds.length
      ? or(
          eq(schema.brainIngestQueue.sourceId, sourceId),
          inArray(schema.brainIngestQueue.captureId, captureIds),
        )!
      : eq(schema.brainIngestQueue.sourceId, sourceId);

    const queueRows = await db
      .select({
        id: schema.brainIngestQueue.id,
        captureId: schema.brainIngestQueue.captureId,
        status: schema.brainIngestQueue.status,
        attempts: schema.brainIngestQueue.attempts,
        error: schema.brainIngestQueue.error,
        runAfter: schema.brainIngestQueue.runAfter,
        createdAt: schema.brainIngestQueue.createdAt,
        updatedAt: schema.brainIngestQueue.updatedAt,
      })
      .from(schema.brainIngestQueue)
      .where(
        and(
          queueSourceFilter,
          eq(schema.brainIngestQueue.operation, "distill"),
        ),
      )
      .orderBy(desc(schema.brainIngestQueue.updatedAt));

    const knowledgeRows = await db
      .select({
        id: schema.brainKnowledge.id,
        title: schema.brainKnowledge.title,
        kind: schema.brainKnowledge.kind,
        summary: schema.brainKnowledge.summary,
        body: schema.brainKnowledge.body,
        status: schema.brainKnowledge.status,
        confidence: schema.brainKnowledge.confidence,
        evidenceJson: schema.brainKnowledge.evidenceJson,
        publishedResourcePath: schema.brainKnowledge.publishedResourcePath,
        publishedAt: schema.brainKnowledge.publishedAt,
        createdAt: schema.brainKnowledge.createdAt,
        updatedAt: schema.brainKnowledge.updatedAt,
      })
      .from(schema.brainKnowledge)
      .where(
        and(
          accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
          eq(schema.brainKnowledge.sourceId, sourceId),
        ),
      )
      .orderBy(desc(schema.brainKnowledge.updatedAt));

    const proposalRows = await db
      .select({
        id: schema.brainProposals.id,
        knowledgeId: schema.brainProposals.knowledgeId,
        captureId: schema.brainProposals.captureId,
        title: schema.brainProposals.title,
        rationale: schema.brainProposals.rationale,
        proposedAction: schema.brainProposals.proposedAction,
        status: schema.brainProposals.status,
        evidenceJson: schema.brainProposals.evidenceJson,
        reviewerNotes: schema.brainProposals.reviewerNotes,
        reviewedAt: schema.brainProposals.reviewedAt,
        createdAt: schema.brainProposals.createdAt,
        updatedAt: schema.brainProposals.updatedAt,
      })
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          eq(schema.brainProposals.sourceId, sourceId),
        ),
      )
      .orderBy(desc(schema.brainProposals.updatedAt));

    const captureCounts = countByStatus(captureRows, CAPTURE_STATUSES);
    const queueCounts = countByStatus(queueRows, QUEUE_STATUSES);
    const staleQueue = distillationQueueStaleCounts(queueRows);
    const knowledgeCounts = countByStatus(knowledgeRows, KNOWLEDGE_STATUSES);
    const proposalCounts = countByStatus(proposalRows, PROPOSAL_STATUSES);

    const recentCaptures = recentCaptureRows.map((capture) => {
      const metadata = parseJson<Record<string, unknown>>(
        capture.metadataJson,
        {},
      );
      return {
        id: capture.id,
        title: redactSensitiveText(capture.title),
        kind: capture.kind,
        status: capture.status,
        capturedAt: capture.capturedAt,
        sourceUrl: sourceUrlFromMetadata(metadata),
        preview: cleanPreview(capture.content, 220),
        createdAt: capture.createdAt,
        updatedAt: capture.updatedAt,
      };
    });

    const recentKnowledge = knowledgeRows
      .slice(0, RECENT_LIMIT)
      .map((knowledge) => {
        const citation = serializeCitation(
          firstCitation(knowledge.evidenceJson),
        );
        return {
          id: knowledge.id,
          title: redactSensitiveText(knowledge.title),
          kind: knowledge.kind,
          status: knowledge.status,
          confidence: knowledge.confidence,
          summary: cleanPreview(knowledge.summary || knowledge.body, 220),
          sourceUrl: sourceUrlFromEvidence(knowledge.evidenceJson),
          citation,
          publishedResourcePath: knowledge.publishedResourcePath,
          publishedAt: knowledge.publishedAt,
          createdAt: knowledge.createdAt,
          updatedAt: knowledge.updatedAt,
        };
      });

    const recentProposals = proposalRows
      .slice(0, RECENT_LIMIT)
      .map((proposal) => {
        const citation = serializeCitation(
          firstCitation(proposal.evidenceJson),
        );
        return {
          id: proposal.id,
          knowledgeId: proposal.knowledgeId,
          captureId: proposal.captureId,
          title: redactSensitiveText(proposal.title),
          proposedAction: proposal.proposedAction,
          status: proposal.status,
          rationale: proposal.rationale
            ? cleanPreview(proposal.rationale, 220)
            : "",
          sourceUrl: sourceUrlFromEvidence(proposal.evidenceJson),
          citation,
          reviewerNotes: proposal.reviewerNotes
            ? cleanPreview(proposal.reviewerNotes, 180)
            : null,
          reviewedAt: proposal.reviewedAt,
          createdAt: proposal.createdAt,
          updatedAt: proposal.updatedAt,
        };
      });

    const privacyNotes = buildPrivacyNotes({
      sourceProvider: access.resource.provider,
      captureCounts,
      knowledgeCounts,
      queueCounts,
      staleQueue,
    });
    const recommendedNextSteps = buildRecommendedNextSteps({
      sourceStatus: access.resource.status,
      sourceLastError: access.resource.lastError,
      latestSyncStatus: latestSyncRun?.status ?? null,
      captureCounts,
      knowledgeCounts,
      proposalCounts,
      queueCounts,
      staleQueue,
    });
    const pilotTrustLane =
      access.resource.provider === "slack"
        ? buildPilotTrustLane({
            targetChannel,
            sourceProvider: access.resource.provider,
            latestSyncStatus: latestSyncRun?.status ?? null,
            captureCounts,
            knowledgeCounts,
            proposalCounts,
            queueCounts,
            staleQueue,
          })
        : undefined;

    return {
      source: {
        ...serializeSource(access.resource),
        title: redactSensitiveText(access.resource.title),
        lastError: redactOptionalText(access.resource.lastError) ?? null,
      },
      accessRole: access.role,
      generatedAt: new Date().toISOString(),
      latestSyncRun: latestSyncRun
        ? {
            id: latestSyncRun.id,
            provider: latestSyncRun.provider,
            status: latestSyncRun.status,
            stats: parseJson<Record<string, unknown>>(
              latestSyncRun.statsJson,
              {},
            ),
            error: redactOptionalText(latestSyncRun.error) ?? null,
            startedAt: latestSyncRun.startedAt,
            completedAt: latestSyncRun.completedAt,
          }
        : null,
      captures: {
        counts: captureCounts,
        recent: recentCaptures,
      },
      distillationQueue: {
        counts: queueCounts,
        stale: staleQueue,
        recent: queueRows.slice(0, RECENT_LIMIT).map((queue) => ({
          id: queue.id,
          captureId: queue.captureId,
          status: queue.status,
          attempts: queue.attempts,
          error: queue.error ? cleanPreview(queue.error, 220) : null,
          runAfter: queue.runAfter,
          createdAt: queue.createdAt,
          updatedAt: queue.updatedAt,
        })),
      },
      knowledge: {
        counts: knowledgeCounts,
        recent: recentKnowledge,
      },
      proposals: {
        counts: proposalCounts,
        recent: recentProposals,
      },
      privacyNotes,
      recommendedNextSteps,
      pilotTrustLane,
    };
  },
});
