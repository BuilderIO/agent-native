import { createContext, useContext, useEffect, type ReactNode } from "react";

import type { ReviewAgentController } from "./use-review-agent-requests";

const ReviewAgentContext = createContext<ReviewAgentController | null>(null);

/**
 * Hands one controller to every comment overlay. The editor builds it, so its
 * menu handler can start runs too. A null controller (not an editor, or signed
 * out) keeps the same tree shape, so the editor never remounts when access
 * resolves; surfaces outside the editor (Present) have no provider at all.
 */
export function ReviewAgentProvider({
  controller,
  children,
}: {
  controller: ReviewAgentController | null;
  children: ReactNode;
}) {
  return (
    <ReviewAgentContext.Provider value={controller}>
      {children}
    </ReviewAgentContext.Provider>
  );
}

/** The controller, or null when this surface has no agent features. */
export function useReviewAgent(): ReviewAgentController | null {
  return useContext(ReviewAgentContext);
}

/** Tells the controller a comment surface is open so it loads the model list. */
export function useReviewAgentSurface(open: boolean) {
  const markSurfaceUsed = useReviewAgent()?.markSurfaceUsed;
  useEffect(() => {
    if (open) markSurfaceUsed?.();
  }, [markSurfaceUsed, open]);
}
