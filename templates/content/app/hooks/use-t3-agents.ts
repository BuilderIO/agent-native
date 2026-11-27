import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef } from "react";

import { useT3AgentsLab } from "./use-t3-agents-lab";

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

export function useT3Agents(): T3Agent[] {
  const labEnabled = useT3AgentsLab();
  const status = useActionQuery<T3CodeStatus>(
    "get-t3-code-status" as never,
    undefined,
    { enabled: labEnabled, staleTime: 60_000 },
  );
  if (!labEnabled || status.data?.state !== "connected") return [];
  if (status.data.access !== "operate") return [];
  return status.data.agents.map(({ kind, name }) => ({ kind, name }));
}

export interface T3AgentRequestsController {
  agents: T3Agent[];
  requests: T3AgentRequest[];
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

interface T3AgentRequestList {
  requests: T3AgentRequest[];
  unreachable?: boolean;
}

function useT3AgentRequestList(documentId: string, enabled: boolean) {
  return useActionQuery<T3AgentRequestList>(
    "list-t3-agent-requests" as never,
    { documentId },
    { enabled },
  );
}

export function useT3AgentRequestSync(documentId: string): void {
  const labEnabled = useT3AgentsLab();
  const queryClient = useQueryClient();
  const query = useT3AgentRequestList(documentId, labEnabled);
  const active = (query.data?.requests ?? EMPTY.requests).some(
    isT3AgentRequestActive,
  );
  const syncing = useRef(false);

  useEffect(() => {
    if (!labEnabled || !active) return;
    const queryKey = ["action", "list-t3-agent-requests", { documentId }];
    let stopped = false;
    const sync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const result = (await callAction(
          "sync-t3-agent-requests" as never,
          { documentId } as never,
        )) as T3AgentRequestList;
        if (stopped) return;
        queryClient.setQueryData<T3AgentRequestList>(queryKey, {
          requests: result.requests,
          unreachable: result.unreachable === true,
        });
      } catch {
        // coercion-ok: a failed sync leaves each request where it was; the next tick tries again.
        if (!stopped)
          queryClient.setQueryData<T3AgentRequestList>(queryKey, (list) =>
            list ? { ...list, unreachable: true } : list,
          );
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
  }, [active, documentId, labEnabled, queryClient]);
}

export function useT3AgentRequests(
  documentId: string,
): T3AgentRequestsController {
  const labEnabled = useT3AgentsLab();
  const agents = useT3Agents();
  const query = useT3AgentRequestList(documentId, labEnabled);
  const requests = query.data?.requests ?? EMPTY.requests;
  const unreachable =
    query.data?.unreachable === true && requests.some(isT3AgentRequestActive);
  return labEnabled ? { agents, requests, unreachable } : EMPTY;
}

export function lastAnsweredThread(
  requests: readonly T3AgentRequest[],
  agent: T3AgentKind,
): { threadId: string; title: string | null } | null {
  const answered = requests.reduce<T3AgentRequest | null>(
    (latest, request) =>
      request.agent === agent &&
      request.status === "answered" &&
      request.t3ThreadId &&
      (!latest || request.updatedAt.localeCompare(latest.updatedAt) > 0)
        ? request
        : latest,
    null,
  );
  return answered?.t3ThreadId
    ? { threadId: answered.t3ThreadId, title: answered.t3ThreadTitle }
    : null;
}

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
