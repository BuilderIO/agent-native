import { useActionQuery } from "@agent-native/core/client/hooks";

export type HostSchedulingStatus =
  | "not-overlaid"
  | "awaiting-reciprocal-overlay"
  | "missing-schedule"
  | "active";

export interface HostSchedulingStatusResult {
  email: string;
  status: HostSchedulingStatus;
}

export function useHostSchedulingStatus(hostEmails: string[]) {
  return useActionQuery<HostSchedulingStatusResult[]>(
    "get-host-scheduling-status",
    { hostEmails },
    { enabled: hostEmails.length > 0 },
  );
}
