import { useEffect, useMemo, useRef } from "react";

import { useActionQuery } from "../use-action.js";

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

export interface ResourceAccessGateStatus {
  state: ResourceAccessGateState;
  /** The viewer's role, only when they can open the resource. */
  role?: ResourceAccessGateRole;
}

export interface ResourceAccessGateOptions {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
  /**
   * Called when a viewer who couldn't open the resource can now, for example
   * because the owner shared it while this screen was open. The status is
   * checked again whenever the window regains focus.
   */
  onAccessGranted?: () => void;
}

export interface ResourceAccessGateController {
  status: ResourceAccessGateStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
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
    { enabled, refetchOnWindowFocus: "always", staleTime: 0 },
  );
  const state = query.data?.state;
  const onAccessGrantedRef = useRef(onAccessGranted);
  onAccessGrantedRef.current = onAccessGranted;
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
    if (state === "allowed" && previous && previous !== "allowed") {
      onAccessGrantedRef.current?.();
    }
  }, [resourceId, state]);

  return {
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
