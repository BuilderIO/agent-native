import { useCallback, useRef, useState } from "react";

import type { ReviewFocusRequest } from "@/components/visual-editor";

export type ReviewFocusTarget = Omit<
  ReviewFocusRequest,
  "nonce" | "onConsumed"
>;

/**
 * The one pending request to open a thread on the canvas. The overlay that
 * acts on it retires it, so an overlay that mounts later (a first frame on an
 * empty board, a screen scrolling back into view) cannot replay a request the
 * user made minutes ago.
 */
export function useReviewFocusRequest() {
  const [request, setRequest] = useState<ReviewFocusRequest | null>(null);
  const nonceRef = useRef(0);
  const issue = useCallback((target: ReviewFocusTarget) => {
    nonceRef.current += 1;
    const nonce = nonceRef.current;
    setRequest({
      ...target,
      nonce,
      onConsumed: () =>
        setRequest((current) => (current?.nonce === nonce ? null : current)),
    });
  }, []);
  return [request, issue] as const;
}
