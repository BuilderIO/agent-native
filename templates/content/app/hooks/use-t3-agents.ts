import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useLabState } from "@agent-native/core/client/labs/use-lab";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** The Lab that lets a person tag their own T3 Code agents in comments. */
export const T3_CODE_AGENTS_LAB = "t3-code-agents";

export type T3AgentKind = "claude-code" | "codex";

export interface T3Agent {
  kind: T3AgentKind;
  name: string;
}

interface T3CodeStatus {
  state: "disconnected" | "connected" | "reconnect" | "unreachable";
  access?: "read" | "operate";
  agents: Array<{ kind: T3AgentKind; name: string }>;
}

export type T3AgentRequestStatus =
  | "sending"
  | "working"
  | "needs-you"
  | "answered"
  | "failed";

export interface T3AgentRequest {
  id: string;
  documentId: string;
  threadId: string;
  commentId: string;
  agent: T3AgentKind;
  status: T3AgentRequestStatus;
  t3ThreadId: string | null;
  t3ThreadTitle: string | null;
  t3ThreadLink: string | null;
  replyCommentId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface T3Thread {
  threadId: string;
  title: string;
  status: string;
  agent: T3AgentKind | null;
  updatedAt: string | null;
}

const SYNC_INTERVAL_MS = 3_000;

export function isT3AgentRequestActive(request: T3AgentRequest) {
  return (
    request.status === "sending" ||
    request.status === "working" ||
    request.status === "needs-you"
  );
}

/**
 * The person's own T3 Code agents they can tag: none unless the Lab is on and
 * T3 Code is connected with leave to start threads.
 */
export function useT3Agents(): T3Agent[] {
  const lab = useLabState(T3_CODE_AGENTS_LAB);
  const status = useActionQuery<T3CodeStatus>(
    "get-t3-code-status" as never,
    undefined,
    { enabled: lab.enabled, staleTime: 60_000 },
  );
  if (!lab.enabled || status.data?.state !== "connected") return [];
  if (status.data.access !== "operate") return [];
  return status.data.agents.map(({ kind, name }) => ({ kind, name }));
}

export interface T3AgentRequestsController {
  /** The person's own agents they can tag here. */
  agents: T3Agent[];
  requests: T3AgentRequest[];
  /** T3 Code couldn't be reached on the last sync. */
  unreachable: boolean;
}

const EMPTY: T3AgentRequestsController = {
  agents: [],
  requests: [],
  unreachable: false,
};

export const T3AgentRequestsContext =
  createContext<T3AgentRequestsController>(EMPTY);

export function useT3AgentRequestsContext() {
  return useContext(T3AgentRequestsContext);
}

/**
 * The person's own agents and their T3 agent requests on a page. While a
 * request is unfinished, the page syncs it every few seconds: that hands a new
 * tag to its thread, follows the thread, and posts the answer.
 */
export function useT3AgentRequests(
  documentId: string,
): T3AgentRequestsController {
  const lab = useLabState(T3_CODE_AGENTS_LAB);
  const agents = useT3Agents();
  const queryClient = useQueryClient();
  const query = useActionQuery<{ requests: T3AgentRequest[] }>(
    "list-t3-agent-requests" as never,
    { documentId },
    { enabled: lab.enabled },
  );
  const requests = query.data?.requests ?? EMPTY.requests;
  const active = requests.some(isT3AgentRequestActive);
  const [unreachable, setUnreachable] = useState(false);
  const syncing = useRef(false);

  useEffect(() => {
    if (!lab.enabled || !active) {
      setUnreachable(false);
      return;
    }
    let stopped = false;
    const sync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const result = (await callAction(
          "sync-t3-agent-requests" as never,
          { documentId } as never,
        )) as { requests: T3AgentRequest[]; unreachable?: boolean };
        if (stopped) return;
        setUnreachable(Boolean(result.unreachable));
        queryClient.setQueryData(
          ["action", "list-t3-agent-requests", { documentId }],
          { requests: result.requests },
        );
      } catch {
        // coercion-ok: a failed sync leaves each request where it was; the next tick tries again.
        if (!stopped) setUnreachable(true);
      } finally {
        syncing.current = false;
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, documentId, lab.enabled, queryClient]);

  return lab.enabled ? { agents, requests, unreachable } : EMPTY;
}

/** The thread that last answered for `agent` on this page, if any. */
export function lastAnsweredThread(
  requests: readonly T3AgentRequest[],
  agent: T3AgentKind,
): { threadId: string; title: string | null } | null {
  const answered = requests
    .filter(
      (request) =>
        request.agent === agent &&
        request.status === "answered" &&
        request.t3ThreadId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .at(0);
  return answered?.t3ThreadId
    ? { threadId: answered.t3ThreadId, title: answered.t3ThreadTitle }
    : null;
}

/** An agent's T3 threads, searched by title when `query` is set. */
export function useT3Threads(
  agent: T3AgentKind | null,
  query: string,
  enabled: boolean,
) {
  return useActionQuery<{ threads: T3Thread[] }>(
    "search-t3-code-threads" as never,
    { agent: agent ?? "claude-code", ...(query.trim() ? { query } : {}) },
    { enabled: enabled && agent !== null, staleTime: 30_000 },
  );
}
