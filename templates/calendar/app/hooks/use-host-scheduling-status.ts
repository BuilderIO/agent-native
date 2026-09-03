import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";

export type HostSchedulingStatus =
  | "not-overlaid"
  | "awaiting-reciprocal-overlay"
  | "missing-schedule"
  | "missing-timezone"
  | "active";

export interface HostSchedulingStatusResult {
  email: string;
  status: HostSchedulingStatus;
  /** Only set when status is "active" — the time zone whose hours are enforced. */
  timezone?: string;
}

/** Matches the get-host-scheduling-status action's schema cap. */
export const MAX_HOST_SCHEDULING_STATUS_EMAILS = 50;

export function useHostSchedulingStatus(
  hostEmails: string[],
  bookingLinkId?: string,
) {
  return useActionQuery<HostSchedulingStatusResult[]>(
    "get-host-scheduling-status",
    {
      hostEmails: hostEmails.slice(0, MAX_HOST_SCHEDULING_STATUS_EMAILS),
      bookingLinkId,
    },
    { enabled: hostEmails.length > 0 },
  );
}

export interface RequestOverlayReciprocationResult {
  sent: boolean;
  nextAvailableAt?: string;
  reason?:
    | "cooldown"
    | "already-reciprocal"
    | "email-not-configured"
    | "not-overlaid"
    | "rate-limited";
}

export function useRequestOverlayReciprocation() {
  // useActionMutation already invalidates every ["action", ...] query
  // (including get-host-scheduling-status) on success, so the tooltip
  // badge picks up a changed reciprocal state without a second, narrower
  // invalidation here.
  return useActionMutation<
    RequestOverlayReciprocationResult,
    { peerEmail: string; bookingLinkId?: string }
  >("request-overlay-reciprocation");
}
