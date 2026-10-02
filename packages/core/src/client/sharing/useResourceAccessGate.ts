import { useCallback, useEffect, useMemo, useRef } from "react";

import { useActionMutation, useActionQuery } from "../use-action.js";

/** Mirrors the server's `ResourceAccessState`. */
export type ResourceAccessGateState =
  | "allowed"
  | "trashed"
  | "denied"
  | "missing"
  | "signed-out";

export type ResourceAccessGateRole =
  | "owner"
  | "admin"
  | "editor"
  | "commenter"
  | "viewer";

/** The viewer's own open request for access. */
export interface ResourceAccessGateRequest {
  state: "pending";
  requestedAt: string;
}

export interface ResourceAccessGateStatus {
  state: ResourceAccessGateState;
  /** The viewer's role, only when they can open the resource. */
  role?: ResourceAccessGateRole;
  /** Whether the viewer can ask for access now. Only for `denied`. */
  canRequest?: boolean;
  /** The viewer's open request. Only for `denied`. */
  request?: ResourceAccessGateRequest;
}

/** Why asking for access failed, for the screen to explain. */
export interface ResourceAccessRequestFailure {
  /** The server's error code, such as `access_request_rate_limited`. */
  errorCode: string | null;
  /** When the viewer can try again, if the server said. */
  retryAt: string | null;
}

export interface ResourceAccessGateOptions {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
  /**
   * Called once when the status says the viewer can open the resource: either
   * the read that failed should be tried again, or the owner shared it while
   * this screen was open. The status is checked again whenever the window
   * regains focus, including switching back from another browser window, and
   * every half minute while the viewer's request is open.
   */
  onAccessGranted?: () => void;
}

export interface ResourceAccessGateController {
  status: ResourceAccessGateStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  /**
   * Asks the owner for access, with an optional note. Resolves once the
   * request is stored and the status shows it; rejects when it fails, with
   * the reason in `requestError`.
   */
  requestAccess: (note?: string) => Promise<void>;
  isRequesting: boolean;
  requestError: ResourceAccessRequestFailure | null;
}

// While a request is open, approving it should open the resource without a
// manual reload, even when the window never loses focus.
const PENDING_REQUEST_POLL_MS = 30_000;

function requestFailure(error: Error): ResourceAccessRequestFailure {
  const failure = error as Error & {
    errorCode?: unknown;
    details?: { retryAt?: unknown };
  };
  return {
    errorCode: typeof failure.errorCode === "string" ? failure.errorCode : null,
    retryAt:
      typeof failure.details?.retryAt === "string"
        ? failure.details.retryAt
        : null,
  };
}

/**
 * Asks the server what a link the viewer couldn't open should say. Use it
 * after a resource read fails with 403 or 404, then render the matching
 * access screen.
 */
export function useResourceAccessGate({
  resourceType,
  resourceId,
  enabled = true,
  onAccessGranted,
}: ResourceAccessGateOptions): ResourceAccessGateController {
  const params = useMemo(
    () => ({ resourceType, resourceId }),
    [resourceId, resourceType],
  );
  const query = useActionQuery<ResourceAccessGateStatus>(
    "get-resource-access-status",
    params,
    {
      enabled,
      refetchOnWindowFocus: "always",
      staleTime: 0,
      refetchInterval: (current) =>
        current.state.data?.request ? PENDING_REQUEST_POLL_MS : false,
    },
  );
  const request = useActionMutation<
    unknown,
    { resourceType: string; resourceId: string; note?: string }
  >("request-resource-access");
  const state = query.data?.state;
  const onAccessGrantedRef = useRef(onAccessGranted);
  onAccessGrantedRef.current = onAccessGranted;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const lastSeenRef = useRef<{
    resourceId: string;
    state: ResourceAccessGateState;
  } | null>(null);

  useEffect(() => {
    if (!state) return;
    const previous =
      lastSeenRef.current?.resourceId === resourceId
        ? lastSeenRef.current.state
        : null;
    lastSeenRef.current = { resourceId, state };
    if (state === "allowed" && previous !== "allowed") {
      onAccessGrantedRef.current?.();
    }
  }, [resourceId, state]);

  // React Query refetches when the tab becomes visible, but not when focus
  // returns from another window that left this tab visible, such as the
  // owner's window beside it.
  useEffect(() => {
    if (!enabled) return;
    const refetch = () => void refetchRef.current({ cancelRefetch: false });
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [enabled]);

  const { mutateAsync: requestAsync } = request;
  const requestAccess = useCallback(
    async (note?: string) => {
      const trimmed = note?.trim();
      await requestAsync({
        resourceType,
        resourceId,
        ...(trimmed ? { note: trimmed } : {}),
      });
      await refetchRef.current({ cancelRefetch: false });
    },
    [requestAsync, resourceId, resourceType],
  );

  return {
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    requestAccess,
    isRequesting: request.isPending,
    requestError: request.error ? requestFailure(request.error) : null,
  };
}
