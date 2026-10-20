import { defineAction } from "@agent-native/core/action";
import { listAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CLIPS_AI_REQUEST_KINDS } from "../shared/ai-request-status.js";
import { listAutoTitleCandidates } from "./lib/auto-title-candidates.js";

const REQUEST_PREFIX = "clips-ai-request-";
const STATUS_PREFIX = "clips-ai-request-status-";
const WORKFLOW_PREFIX = "clips-workflow-";
const WORKFLOW_TAB_PREFIX = "clips-workflow:";
// Tabs from the retired chat-panel path end in a random chat id and have no
// background-session receipt; deriving one would mark live runs failed.
const WORKFLOW_SESSION_TAB_SUFFIX = ":run";

type QueuedAiRequest = Record<string, unknown> & { recordingId: string };

interface ActiveAiRequestSession {
  recordingId: string;
  kind: (typeof CLIPS_AI_REQUEST_KINDS)[number] | "generate-workflow";
  requestedAt: string;
  requestId?: string;
  operationId: string;
  threadId: string;
  turnId: string;
  runId?: string;
  updatedAt?: string;
}

async function listQueuedRequests(): Promise<{
  requests: QueuedAiRequest[];
  activeSessions: ActiveAiRequestSession[];
}> {
  const [entries, statusEntries, workflowEntries] = await Promise.all([
    listAppState(REQUEST_PREFIX),
    listAppState(STATUS_PREFIX),
    listAppState(WORKFLOW_PREFIX),
  ]);

  const statusByRecordingId = new Map(
    statusEntries.map((entry) => [
      entry.key.slice(STATUS_PREFIX.length),
      entry.value,
    ]),
  );
  const requests = entries
    .map((e) => e.value as Record<string, unknown>)
    .filter(
      (v): v is QueuedAiRequest =>
        !!v && typeof v.recordingId === "string" && v.recordingId.length > 0,
    )
    .filter((request) => {
      const status = statusByRecordingId.get(request.recordingId);
      if (!status) return true;
      if (
        status.kind !== request.kind ||
        status.requestedAt !== request.requestedAt
      ) {
        return false;
      }
      if (
        ["completed", "failed", "truncated", "cancelled"].includes(
          String(status.status),
        )
      ) {
        return false;
      }
      return !(
        status.status === "working" &&
        typeof status.operationId === "string" &&
        typeof status.threadId === "string" &&
        typeof status.turnId === "string"
      );
    });

  const kinds: readonly unknown[] = CLIPS_AI_REQUEST_KINDS;
  const requestSessions = statusEntries
    .map((entry): Record<string, unknown> & { recordingId: string } => ({
      ...(entry.value as Record<string, unknown>),
      recordingId: entry.key.slice(STATUS_PREFIX.length),
    }))
    .filter(
      (status): status is ActiveAiRequestSession & Record<string, unknown> =>
        kinds.includes(status.kind) &&
        status.status === "working" &&
        typeof status.requestedAt === "string" &&
        typeof status.operationId === "string" &&
        typeof status.threadId === "string" &&
        typeof status.turnId === "string",
    );

  const workflowSessions = workflowEntries.flatMap(
    (entry): ActiveAiRequestSession[] => {
      const state = entry.value as Record<string, unknown> | null;
      if (
        !state ||
        state.status !== "generating" ||
        typeof state.tabId !== "string" ||
        !state.tabId.startsWith(WORKFLOW_TAB_PREFIX) ||
        !state.tabId.endsWith(WORKFLOW_SESSION_TAB_SUFFIX) ||
        typeof state.requestedAt !== "string"
      ) {
        return [];
      }
      return [
        {
          recordingId: entry.key.slice(WORKFLOW_PREFIX.length),
          kind: "generate-workflow",
          requestedAt: state.requestedAt,
          ...(typeof state.requestId === "string"
            ? { requestId: state.requestId }
            : {}),
          operationId: state.tabId,
          threadId: state.tabId,
          turnId: backgroundAgentTurnIdForReceipt(state.tabId, state.tabId),
        },
      ];
    },
  );
  const activeSessions = [...requestSessions, ...workflowSessions];

  const recordingIds = [
    ...new Set([
      ...requests.map((request) => request.recordingId),
      ...activeSessions.map((session) => session.recordingId),
    ]),
  ];
  if (recordingIds.length === 0) return { requests: [], activeSessions: [] };

  const db = getDb();
  const accessible = await db
    .select({ id: schema.recordings.id, title: schema.recordings.title })
    .from(schema.recordings)
    .where(
      and(
        accessFilter(schema.recordings, schema.recordingShares),
        inArray(schema.recordings.id, recordingIds),
        eq(schema.recordings.status, "ready"),
      ),
    );

  const titles = new Map(accessible.map((r) => [r.id, r.title]));

  // Not every request kind stores `currentTitle` when queued; fill it from the
  // recording so every delivered request tells the agent what the clip is.
  return {
    requests: requests
      .filter((request) => titles.has(request.recordingId))
      .map((request) => ({
        ...request,
        currentTitle: request.currentTitle ?? titles.get(request.recordingId),
      })),
    activeSessions: activeSessions.filter((session) =>
      titles.has(session.recordingId),
    ),
  };
}

export default defineAction({
  description:
    "List pending clips AI requests and active background AI sessions for recordings the current user can access, plus ready recordings that still need an auto-generated title.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    const [{ requests, activeSessions }, titleCandidates] = await Promise.all([
      listQueuedRequests(),
      email ? listAutoTitleCandidates(email) : [],
    ]);
    return { requests, activeSessions, titleCandidates };
  },
});
