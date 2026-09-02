import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";

export type HostSchedulingStatus =
  | "not-overlaid"
  | "awaiting-reciprocal-overlay"
  | "missing-schedule"
  | "active";

export interface HostSchedulingStatusResult {
  email: string;
  status: HostSchedulingStatus;
  /** Only set when status is "active" — the time zone whose hours are enforced. */
  timezone?: string;
}

export function useHostSchedulingStatus(hostEmails: string[]) {
  return useActionQuery<HostSchedulingStatusResult[]>(
    "get-host-scheduling-status",
    { hostEmails },
    { enabled: hostEmails.length > 0 },
  );
}

export interface RequestOverlayReciprocationResult {
  sent: boolean;
  nextAvailableAt?: string;
  reason?: "cooldown" | "already-reciprocal" | "email-not-configured";
}

export function useRequestOverlayReciprocation() {
  return useActionMutation<
    RequestOverlayReciprocationResult,
    { peerEmail: string }
  >("request-overlay-reciprocation");
}
