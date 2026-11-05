import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  DESIGN_WRITE_FAILED_EVENT,
  DESIGN_WRITE_FAILED_KEY,
  type DesignWriteFailureDetail,
} from "@/lib/design-write-failure";

function authoredMessage(error: unknown): string | undefined {
  // A 5xx body is the server's masked "Internal server error", which tells the
  // user nothing; only a typed 4xx refusal carries a message worth showing.
  const status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status === "number" && status >= 500) return undefined;
  return actionErrorMessage(error);
}

/**
 * Shows the real reason when a Design write fails. Typed action refusals carry
 * their own message; anything else gets the generic one, so a failed write is
 * never silent.
 */
export function DesignWriteFailureToasts() {
  const queryClient = useQueryClient();
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const show = (error: unknown, messageKey: string) => {
      const message = authoredMessage(error) ?? tRef.current(messageKey);
      // The message doubles as the id so a burst of the same failure is one toast.
      toast.error(message, { id: message });
    };
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      if (event.mutation.meta?.errorHandled) return;
      show(event.action.error, DESIGN_WRITE_FAILED_KEY);
    });
    const onReported = (event: Event) => {
      const { error, messageKey } = (
        event as CustomEvent<DesignWriteFailureDetail>
      ).detail;
      show(error, messageKey);
    };
    window.addEventListener(DESIGN_WRITE_FAILED_EVENT, onReported);
    return () => {
      unsubscribe();
      window.removeEventListener(DESIGN_WRITE_FAILED_EVENT, onReported);
    };
  }, [queryClient]);

  return null;
}
