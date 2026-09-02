import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

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

export function useHostSchedulingStatus(hostEmails: string[]) {
  return useActionQuery<HostSchedulingStatusResult[]>(
    "get-host-scheduling-status",
    { hostEmails: hostEmails.slice(0, MAX_HOST_SCHEDULING_STATUS_EMAILS) },
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
    | "not-overlaid";
}

export function useRequestOverlayReciprocation() {
  const queryClient = useQueryClient();
  return useActionMutation<
    RequestOverlayReciprocationResult,
    { peerEmail: string }
  >("request-overlay-reciprocation", {
    onSuccess: () => {
      // The peer's reciprocal state may have just changed (or turned out to
      // already have changed) — refresh so the tooltip badge reflects it.
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-host-scheduling-status"],
      });
    },
  });
}
