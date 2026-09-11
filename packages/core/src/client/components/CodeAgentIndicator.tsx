/**
 * CodeAgentIndicator — shows when a code editing request is being
 * processed by the frame (local dev frame or Builder.io).
 *
 * Renders as a subtle status bar that appears at the top of the chat area.
 */

import { useEffect, useState } from "react";

export interface CodeAgentIndicatorProps {
  /** Whether the code agent is currently working */
  isWorking: boolean;
  /** Optional label describing what's being done */
  label?: string;
}

export function CodeAgentIndicator({
  isWorking,
  label,
}: CodeAgentIndicatorProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isWorking) {
      setVisible(true);
    } else {
      // Brief delay before hiding so the user sees "done"
      const t = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(t);
    }
  }, [isWorking]);

  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[11px]"
      style={{
        background: isWorking
          ? "hsl(var(--accent) / 0.3)"
          : "hsl(var(--accent) / 0.15)",
      }}
    >
      {isWorking ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-muted-foreground">
            {label || "Code agent is working on your request..."}
          </span>
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          <span className="text-muted-foreground">Code changes applied</span>
        </>
      )}
    </div>
  );
}
