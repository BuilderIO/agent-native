import { agentNativePath } from "./api-path.js";
import {
  isRecord,
  malformedFrameworkRouteResponse,
  requestFrameworkRouteJson,
} from "./framework-route-request.js";

const LIST_ROUTE = "checkpoints";
const RESTORE_ROUTE = "checkpoints/restore";

export interface ChatCheckpoint {
  id: string;
  threadId: string;
  runId: string | null;
  commitSha: string;
  message: string;
  createdAt: number;
}

function defaultChatApiUrl(): string {
  return agentNativePath("/_agent-native/agent-chat");
}

function readCreatedAt(value: unknown): number | null {
  // PostgreSQL BIGINT columns can arrive as numeric strings.
  const createdAt =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : null;
}

/**
 * The dev-mode git checkpoints saved for a thread, newest first. Throws
 * `FrameworkRouteError` when the list cannot be read (including the 403 a
 * non-dev or non-localhost server answers), so a failed read is never an
 * empty list.
 */
export async function listChatCheckpoints(input: {
  threadId: string;
  apiUrl?: string;
  signal?: AbortSignal;
}): Promise<ChatCheckpoint[]> {
  const apiUrl = input.apiUrl ?? defaultChatApiUrl();
  const { status, body } = await requestFrameworkRouteJson(
    LIST_ROUTE,
    `${apiUrl}/checkpoints?threadId=${encodeURIComponent(input.threadId)}`,
    input.signal ? { signal: input.signal } : undefined,
  );
  if (!Array.isArray(body)) {
    throw malformedFrameworkRouteResponse(LIST_ROUTE, status, "not a list");
  }
  return body.map((row) => {
    const createdAt = isRecord(row) ? readCreatedAt(row.createdAt) : null;
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.threadId !== "string" ||
      !(row.runId === null || typeof row.runId === "string") ||
      typeof row.commitSha !== "string" ||
      typeof row.message !== "string" ||
      createdAt === null
    ) {
      throw malformedFrameworkRouteResponse(
        LIST_ROUTE,
        status,
        "invalid checkpoint row",
      );
    }
    return {
      id: row.id,
      threadId: row.threadId,
      runId: row.runId || null,
      commitSha: row.commitSha,
      message: row.message,
      createdAt,
    };
  });
}

export type ChatCheckpointRestoreTarget =
  | { runId: string; checkpointId?: never }
  | { checkpointId: string; runId?: never };

/**
 * Reset the working tree to a checkpoint, by the run that produced it or by
 * checkpoint id. Resolves only when the server confirms the restore; any other
 * answer throws `FrameworkRouteError`, whose `serverMessage` carries the
 * server's reason (for example, that no checkpoint was saved for that turn).
 */
export async function restoreChatCheckpoint(
  input: ChatCheckpointRestoreTarget & { apiUrl?: string },
): Promise<{ commitSha: string }> {
  const apiUrl = input.apiUrl ?? defaultChatApiUrl();
  const target =
    typeof input.runId === "string"
      ? { runId: input.runId }
      : { checkpointId: input.checkpointId };
  const { status, body } = await requestFrameworkRouteJson(
    RESTORE_ROUTE,
    `${apiUrl}/checkpoints/restore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    },
  );
  if (
    !isRecord(body) ||
    body.success !== true ||
    typeof body.commitSha !== "string"
  ) {
    throw malformedFrameworkRouteResponse(
      RESTORE_ROUTE,
      status,
      "restore was not confirmed",
    );
  }
  return { commitSha: body.commitSha };
}
