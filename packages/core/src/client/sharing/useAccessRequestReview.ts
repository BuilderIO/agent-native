import { useCallback, useMemo, useState } from "react";

import { useActionMutation, useActionQuery } from "../use-action.js";
import type { ResourceAccessRequestFailure } from "./useResourceAccessGate.js";

export type AccessRequestRole = "viewer" | "commenter" | "editor" | "admin";

/** One access request, as someone who manages access reviews it. */
export interface AccessRequestReview {
  id: string;
  generation: number;
  state: "pending" | "approved" | "declined";
  requester: { email: string; name: string | null };
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  grantedRole: AccessRequestRole | null;
  resource: {
    type: string;
    id: string;
    label: string;
    title: string;
    path: string | null;
  };
}

export interface AccessRequestDecisionFailure extends ResourceAccessRequestFailure {
  /**
   * Why the server refused, such as a sharing rule. Absent for unexpected
   * failures, whose server message isn't meant for people.
   */
  message: string | null;
}

export interface AccessRequestDecisions {
  approve: (
    request: Pick<AccessRequestReview, "id" | "generation">,
    role: AccessRequestRole,
  ) => Promise<void>;
  decline: (
    request: Pick<AccessRequestReview, "id" | "generation">,
  ) => Promise<void>;
  /** The request a decision is in flight for. */
  pendingId: string | null;
  error: AccessRequestDecisionFailure | null;
}

function decisionFailure(error: unknown): AccessRequestDecisionFailure | null {
  if (!error) return null;
  const failure = error as Error & {
    status?: unknown;
    errorCode?: unknown;
    actionMessage?: unknown;
    details?: { retryAt?: unknown };
  };
  const refused = failure.status === 400 || failure.status === 403;
  return {
    errorCode: typeof failure.errorCode === "string" ? failure.errorCode : null,
    message:
      refused && typeof failure.actionMessage === "string"
        ? failure.actionMessage
        : null,
    retryAt:
      typeof failure.details?.retryAt === "string"
        ? failure.details.retryAt
        : null,
  };
}

/** Allow and Decline, shared by the approval page and the Share dialog. */
export function useAccessRequestDecisions(): AccessRequestDecisions {
  const { mutateAsync: approveAsync } = useActionMutation<
    unknown,
    { requestId: string; generation: number; role: AccessRequestRole }
  >("approve-resource-access-request");
  const { mutateAsync: declineAsync } = useActionMutation<
    unknown,
    { requestId: string; generation: number }
  >("decline-resource-access-request");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const decide = useCallback(
    async (requestId: string, run: () => Promise<unknown>) => {
      setPendingId(requestId);
      setError(null);
      try {
        await run();
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setPendingId((current) => (current === requestId ? null : current));
      }
    },
    [],
  );

  const approve = useCallback<AccessRequestDecisions["approve"]>(
    (request, role) =>
      decide(request.id, () =>
        approveAsync({
          requestId: request.id,
          generation: request.generation,
          role,
        }),
      ),
    [approveAsync, decide],
  );
  const decline = useCallback<AccessRequestDecisions["decline"]>(
    (request) =>
      decide(request.id, () =>
        declineAsync({ requestId: request.id, generation: request.generation }),
      ),
    [declineAsync, decide],
  );

  return { approve, decline, pendingId, error: decisionFailure(error) };
}

export interface AccessRequestReviewController {
  review: AccessRequestReview | undefined;
  isLoading: boolean;
  /** The viewer isn't signed in. */
  isSignedOut: boolean;
  /** The request doesn't exist, or the viewer can't manage its resource. */
  isUnavailable: boolean;
  /** Reading the request failed for another reason; retry with `refetch`. */
  isError: boolean;
  refetch: () => Promise<unknown>;
  decisions: AccessRequestDecisions;
}

/**
 * Loads one access request for its approval page. Opening the page only
 * reads; Allow and Decline are explicit calls on `decisions`.
 */
export function useAccessRequestReview(
  requestId: string,
): AccessRequestReviewController {
  const params = useMemo(() => ({ requestId }), [requestId]);
  const query = useActionQuery<AccessRequestReview>(
    "get-resource-access-request",
    params,
    { enabled: Boolean(requestId), retry: false },
  );
  const decisions = useAccessRequestDecisions();
  const status = (query.error as { status?: unknown } | null)?.status;
  const isSignedOut = query.isError && status === 401;
  const isUnavailable = query.isError && status === 404;
  return {
    review: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isUnavailable,
    isError: query.isError && !isSignedOut && !isUnavailable,
    refetch: query.refetch,
    decisions,
  };
}

export interface ResourceAccessRequestsController {
  requests: AccessRequestReview[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  decisions: AccessRequestDecisions;
}

/** Pending access requests for one resource, for its Share dialog. */
export function useResourceAccessRequests({
  resourceType,
  resourceId,
  enabled = true,
}: {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
}): ResourceAccessRequestsController {
  const params = useMemo(
    () => ({ resourceType, resourceId }),
    [resourceId, resourceType],
  );
  const query = useActionQuery<AccessRequestReview[]>(
    "list-resource-access-requests",
    params,
    { enabled, retry: false },
  );
  const decisions = useAccessRequestDecisions();
  return {
    requests: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    decisions,
  };
}
