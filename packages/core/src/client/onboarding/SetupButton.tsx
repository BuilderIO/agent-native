/**
 * <SetupButton /> — re-opens the onboarding panel after it's been dismissed.
 *
 * Only renders when the user has dismissed the panel but still has incomplete
 * required steps. Clicking clears the dismissal flag so the panel reappears.
 */

import React from "react";
import { IconChecklist } from "@tabler/icons-react";
import { useOnboarding } from "./use-onboarding.js";
import { useDevMode } from "../use-dev-mode.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

const DEV_ONLY_STEP_IDS = new Set(["database", "auth"]);

export function SetupButton({ className }: { className?: string }) {
  const { dismissed, loading, steps, reopen } = useOnboarding();
  const { isDevMode } = useDevMode();
  const visibleSteps = isDevMode
    ? steps
    : steps.filter((s) => !DEV_ONLY_STEP_IDS.has(s.id));
  const totalCount = visibleSteps.length;
  const allComplete = visibleSteps
    .filter((s) => s.required)
    .every((s) => s.complete);

  if (loading || totalCount === 0) return null;
  if (!dismissed) return null;
  if (allComplete) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={reopen}
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
          <IconChecklist size={12} />
          Setup
        </button>
      </TooltipTrigger>
      <TooltipContent>Re-open setup</TooltipContent>
    </Tooltip>
  );
}
