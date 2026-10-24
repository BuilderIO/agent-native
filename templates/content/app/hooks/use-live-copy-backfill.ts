import { captureError } from "@agent-native/core/client/analytics";
import { useEffect, useRef } from "react";

import {
  documentScopedQueryFilter,
  useContentActionMutation,
} from "./use-content-action-mutation";

type ConvertPageToLiveCopyResponse = {
  id: string;
  status: "converted" | "current" | "skipped" | "deferred";
};

/**
 * Asks once, after the editor loads a page it can edit, to switch that page
 * to its live copy. The page stays open on its current writer whatever the
 * answer. A failure is logged and reported to error capture; a later open or
 * the backfill sweep tries the page again.
 */
export function useConvertPageToLiveCopyOnOpen(
  documentId: string,
  enabled: boolean,
) {
  const { mutate } = useContentActionMutation<
    ConvertPageToLiveCopyResponse,
    { id: string }
  >("convert-page-to-live-copy-if-due", {
    // A switch re-baselines the page's suggestions and comments too.
    invalidates: (data, variables) =>
      data.status === "converted"
        ? [documentScopedQueryFilter(variables.id)]
        : [],
    onError: (error, variables) => {
      console.error(
        `[live-copy] Page ${variables.id} couldn't switch to its live copy:`,
        error,
      );
      captureError(error, {
        tags: {
          feature: "content-live-body-backfill",
          documentId: variables.id,
        },
      });
    },
  });
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || askedFor.current === documentId) return;
    askedFor.current = documentId;
    mutate({ id: documentId });
  }, [documentId, enabled, mutate]);
}
