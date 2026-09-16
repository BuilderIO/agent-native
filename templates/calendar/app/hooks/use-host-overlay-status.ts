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

// Mirrors the `emails` array cap in the `get-host-overlay-status` action
// schema, which bounds the settings reads (and possible Google lookups) one
// request can trigger. Callers with more emails than this are batched below
// rather than failing the whole query once the owner has more than one page
// of overlay peers.
const HOST_OVERLAY_STATUS_BATCH_SIZE = 50;

/**
 * Whether each overlay-linked booking host's real working hours are applied.
 *
 * `data` is `undefined` while loading *and* on error. Callers must render no
 * icon in that case rather than guessing a state — this is a secondary
 * indicator, and a wrong one is worse than none.
 *
 * Pass `enabled: false` whenever the owner identity is ambiguous (a link that
 * hasn't finished loading), so the query never runs against the wrong owner.
 */
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

/**
 * Which of the caller's overlaid peers have added them back.
 *
 * Deliberately a different action from `useHostOverlayStatus`: this one costs a
 * single settings read per peer and no network calls, which is what makes it
 * safe on the sidebar. Pass `enabled: false` until the surface is actually
 * visible — the sidebar mounts on every page, so an ungated fetch here is a
 * per-navigation cost for something the user may never look at.
 */
export function useOverlayReciprocity(emails: string[], enabled: boolean) {
  return useActionQuery<OverlayReciprocityResult[]>(
    "get-overlay-reciprocity",
    { emails },
    { enabled: enabled && emails.length > 0 },
  );
}
