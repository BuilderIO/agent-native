/**
 * <SetupButton /> — re-opens the onboarding panel after it's been dismissed.
 *
 * Only renders when the user has dismissed the panel but still has incomplete
 * required steps. Clicking clears the dismissal flag so the panel reappears.
 */

import React from "react";
import { IconSparkles } from "@tabler/icons-react";
import { useOnboarding } from "./use-onboarding.js";

export function SetupButton({ className }: { className?: string }) {
  const { dismissed, allComplete, loading, totalCount, reopen } =
    useOnboarding();

  if (loading || totalCount === 0) return null;
  if (!dismissed) return null;
  if (allComplete) return null;

  return (
    <button
      type="button"
      onClick={reopen}
      title="Re-open setup"
      aria-label="Re-open setup"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 5,
        border: "1px solid rgba(96,165,250,0.3)",
        background: "rgba(59,130,246,0.08)",
        color: "#60a5fa",
        fontSize: 11,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      <IconSparkles size={12} />
      Setup
    </button>
  );
}
