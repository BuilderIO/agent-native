/**
 * <OnboardingBanner /> — compact bar for the top of the agent sidebar.
 *
 * Shows "Setup: N of M complete" plus a Continue button that expands the
 * full <OnboardingPanel />. Use when you want the panel collapsed by default.
 */

import React from "react";
import { IconSparkles, IconChevronRight } from "@tabler/icons-react";
import { useOnboarding } from "./use-onboarding.js";

interface OnboardingBannerProps {
  onContinue?: () => void;
  className?: string;
}

export function OnboardingBanner({
  onContinue,
  className,
}: OnboardingBannerProps) {
  const { loading, totalCount, completeCount, allComplete, dismissed } =
    useOnboarding();
  if (loading || totalCount === 0 || allComplete || dismissed) return null;

  return (
    <button
      type="button"
      onClick={onContinue}
      className={className}
      style={styles.root}
    >
      <span style={styles.left}>
        <IconSparkles size={14} style={{ color: "#60a5fa" }} />
        <span style={styles.title}>Setup</span>
        <span style={styles.counter}>
          {completeCount} of {totalCount} complete
        </span>
      </span>
      <span style={styles.cta}>
        Continue
        <IconChevronRight size={12} />
      </span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "8px 12px",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(59,130,246,0.06)",
    color: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left" as const,
  },
  left: { display: "flex", alignItems: "center", gap: 6 },
  title: { fontWeight: 600 },
  counter: { opacity: 0.65, marginLeft: 4 },
  cta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    color: "#60a5fa",
    fontWeight: 500,
  },
};
