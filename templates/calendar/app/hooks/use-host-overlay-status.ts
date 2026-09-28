import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { agentNativeApiDisabledReason } from "@agent-native/core/client/host";
import type {
  HostOverlayStatusResult,
  OverlayReciprocityResult,
  SendOverlayRequestResult,
} from "@shared/api";
import { useQuery } from "@tanstack/react-query";

const HOST_OVERLAY_STATUS_BATCH_SIZE = 50;

export function useHostOverlayStatus(
  emails: string[],
  bookingLinkId: string | undefined,
  enabled: boolean,
) {
  const apiDisabled = Boolean(agentNativeApiDisabledReason());
  return useQuery<HostOverlayStatusResult[]>({
    queryKey: ["action", "get-host-overlay-status", { emails, bookingLinkId }],
    queryFn: async () => {
      const batches: string[][] = [];
      for (let i = 0; i < emails.length; i += HOST_OVERLAY_STATUS_BATCH_SIZE) {
        batches.push(emails.slice(i, i + HOST_OVERLAY_STATUS_BATCH_SIZE));
      }
      const results = await Promise.all(
        batches.map((batch) =>
          callAction<HostOverlayStatusResult[]>(
            "get-host-overlay-status",
            { emails: batch, bookingLinkId },
            { method: "GET" },
          ),
        ),
      );
      return results.flat();
    },
    enabled: apiDisabled ? false : enabled,
  });
}

export function useSendOverlayRequest() {
  return useActionMutation<
    SendOverlayRequestResult,
    { email: string; bookingLinkId?: string }
  >("send-overlay-request", { method: "POST" });
}

export function useOverlayReciprocity(emails: string[], enabled: boolean) {
  return useActionQuery<OverlayReciprocityResult[]>(
    "get-overlay-reciprocity",
    { emails },
    { enabled: enabled && emails.length > 0 },
  );
}
