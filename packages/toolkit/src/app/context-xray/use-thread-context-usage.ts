import { resolveKnownContextWindow } from "@agent-native/core/client/context-xray/format";
import { useActionQuery } from "@agent-native/core/client/use-action";
import type { ContextManifest } from "@agent-native/core/shared/context-xray";
import {
  manifestConversationTokens,
  manifestSystemTokens,
} from "@agent-native/core/shared/context-xray";

/**
 * "absent": the server has no such thread yet (a draft before its first
 * save). "error": the manifest could not be read.
 */
export type ThreadContextUsageStatus = "ready" | "unknown" | "absent" | "error";

export interface ThreadContextUsageSegment {
  /** "System", or a manifest segment group such as "Tool results". */
  kind: string;
  tokens: number;
}

export interface ThreadContextUsage {
  status: ThreadContextUsageStatus;
  /** Set only when `status` is "ready". */
  usedTokens?: number;
  windowTokens?: number;
  segments: ThreadContextUsageSegment[];
  tokenMethod?: ContextManifest["tokenCountMethod"];
  manifest?: ContextManifest | undefined;
  error?: unknown;
  refresh: () => void;
}

export const SYSTEM_CONTEXT_KIND = "System";

/**
 * Tokens per kind as the last model call saw them: system sections, then the
 * conversation segments by group with evicted ones left out. Conversation
 * tokens the segments do not account for stay visible as "Conversation"
 * rather than being spread across the other kinds.
 */
export function contextUsageSegments(
  manifest: ContextManifest,
): ThreadContextUsageSegment[] {
  const byKind = new Map<string, number>();
  const add = (kind: string, tokens: number) => {
    if (tokens > 0) byKind.set(kind, (byKind.get(kind) ?? 0) + tokens);
  };
  add(SYSTEM_CONTEXT_KIND, manifestSystemTokens(manifest));
  let segmentTokens = 0;
  for (const segment of manifest.segments) {
    if (segment.status === "evicted") continue;
    const tokens =
      segment.status === "summarized" && segment.summaryTokenCount !== undefined
        ? segment.summaryTokenCount
        : segment.tokenCount;
    segmentTokens += tokens;
    add(segment.group, tokens);
  }
  add("Conversation", manifestConversationTokens(manifest) - segmentTokens);
  return [...byKind].map(([kind, tokens]) => ({ kind, tokens }));
}

/**
 * Usage for the window of `model` when it is known, else the model the
 * manifest was computed for. A thread with no recorded model call, a model
 * whose window nobody knows, or a manifest still loading is "unknown": the
 * ring hides rather than showing a made-up 0%.
 */
export function summarizeThreadContextUsage(
  manifest: ContextManifest | undefined,
  model: string | undefined,
): Pick<
  ThreadContextUsage,
  "status" | "usedTokens" | "windowTokens" | "segments" | "tokenMethod"
> {
  if (!manifest || manifest.totalTokens <= 0) {
    return { status: "unknown", segments: [] };
  }
  const windowTokens =
    resolveKnownContextWindow(model) ??
    resolveKnownContextWindow(manifest.model);
  if (!windowTokens) return { status: "unknown", segments: [] };
  return {
    status: "ready",
    usedTokens: manifest.totalTokens,
    windowTokens,
    segments: contextUsageSegments(manifest),
    tokenMethod: manifest.tokenCountMethod,
  };
}

function isThreadNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | undefined)?.status === 404;
}

/**
 * True once the thread has a finished assistant reply. Only the server writes
 * one, so the thread is saved and a model call was measured; before that the
 * manifest read is a 404 the browser reports as a console error.
 */
export function threadHasFinishedReply(
  messages: ReadonlyArray<{ role: string; status?: string }>,
): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.status !== "streaming",
  );
}

/**
 * Pass `enabled: false` until the thread exists on the server (see
 * `threadHasFinishedReply`); a draft has no manifest to ask for.
 */
export function useThreadContextUsage({
  threadId,
  model,
  enabled = true,
}: {
  threadId?: string | null | undefined;
  model?: string | undefined;
  enabled?: boolean;
}): ThreadContextUsage {
  const active = Boolean(threadId && enabled);
  const query = useActionQuery(
    "context-manifest-get",
    active && threadId ? { threadId } : undefined,
    { enabled: active, staleTime: 1000 },
  ) as {
    data?: ContextManifest;
    error?: unknown;
    isError?: boolean;
    refetch?: () => unknown;
  };
  const refresh = () => {
    void query.refetch?.();
  };
  if (!active) return { status: "unknown", segments: [], refresh };
  if (query.isError && !query.data) {
    if (isThreadNotFound(query.error)) {
      return { status: "absent", segments: [], refresh };
    }
    return { status: "error", segments: [], error: query.error, refresh };
  }
  return {
    ...summarizeThreadContextUsage(query.data, model),
    manifest: query.data,
    refresh,
  };
}
