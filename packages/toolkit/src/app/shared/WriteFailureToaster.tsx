import { useT } from "@agent-native/core/client/i18n";
import {
  classifyWriteFailure,
  WRITE_FAILURE_EVENT,
  type WriteFailureClassification,
  type WriteFailureDetail,
} from "@agent-native/core/client/write-failure";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

type Translate = ReturnType<typeof useT>;

function failureDescription(
  failure: Extract<WriteFailureClassification, { skip: false }>,
  t: Translate,
): string | undefined {
  if (failure.authoredMessage) return failure.authoredMessage;
  switch (failure.kind) {
    case "offline":
      return t("writeFailure.offline");
    case "timeout":
      return t("writeFailure.timeout");
    case "forbidden":
      return t("writeFailure.forbidden");
    case "refused":
    case "server":
    case "unknown":
      return undefined;
  }
}

/**
 * The one toast for a write that failed with nothing else to say so. Renders
 * nothing: it listens for `reportWriteFailure` and for failed mutations that
 * opted in with `surfaceMutationError`.
 */
export function WriteFailureToaster() {
  const queryClient = useQueryClient();
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const show = (error: unknown, label: string | undefined) => {
      const failure = classifyWriteFailure(error);
      if (failure.skip) return;
      const title = label ?? tRef.current("writeFailure.title");
      const description = failureDescription(failure, tRef.current);
      // The id folds a burst of the same failure into one toast.
      toast.error(title, {
        description,
        id: `${title}|${description ?? ""}`,
      });
    };
    const onReported = (event: Event) => {
      const { error, label } = (event as CustomEvent<WriteFailureDetail>)
        .detail;
      show(error, label);
    };
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const meta = event.mutation.meta;
      if (!meta?.surfaceError) return;
      show(
        event.action.error,
        typeof meta.errorLabel === "string" ? meta.errorLabel : undefined,
      );
    });
    window.addEventListener(WRITE_FAILURE_EVENT, onReported);
    return () => {
      unsubscribe();
      window.removeEventListener(WRITE_FAILURE_EVENT, onReported);
    };
  }, [queryClient]);

  return null;
}
