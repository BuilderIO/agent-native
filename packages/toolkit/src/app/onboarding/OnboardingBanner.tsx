import { useT } from "@agent-native/core/client/i18n";
import { useOnboarding } from "@agent-native/core/client/onboarding/use-onboarding";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconChecklist,
  IconChevronRight,
  IconLoader2,
} from "@tabler/icons-react";
import React, { useState } from "react";

interface OnboardingBannerProps {
  onContinue?: () => void;
  className?: string;
}

export function OnboardingBanner({
  onContinue,
  className,
}: OnboardingBannerProps) {
  const {
    loading,
    totalCount,
    completeCount,
    allComplete,
    dismissed,
    error,
    summaryKnown,
    refresh,
  } = useOnboarding();
  const t = useT();
  const [retrying, setRetrying] = useState(false);

  if (
    loading ||
    (summaryKnown && (dismissed || (totalCount > 0 && allComplete)))
  ) {
    return null;
  }
  if (error && (!summaryKnown || totalCount > 0)) {
    const retry = async () => {
      setRetrying(true);
      try {
        await refresh();
      } finally {
        setRetrying(false);
      }
    };

    return (
      <div role="alert" className={className} style={styles.error}>
        <span>{t("agentChat.common.chunkLoadFailed")}</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="onboarding-summary-retry"
          disabled={retrying}
          onClick={() => void retry()}
        >
          {retrying ? (
            <IconLoader2 className="animate-spin" aria-hidden />
          ) : null}
          {t("agentChat.common.retry")}
        </Button>
      </div>
    );
  }
  if (!summaryKnown || totalCount === 0) return null;

  return (
    <button
      type="button"
      onClick={onContinue}
      className={className}
      style={styles.root}
    >
      <span style={styles.left}>
        <IconChecklist size={14} style={{ color: "#60a5fa" }} />
        <span style={styles.title}>Setup</span>
        <span style={styles.counter}>
          {completeCount} of {totalCount} complete
        </span>
      </span>
      <span style={styles.cta}>
        Continue
        <IconChevronRight size={12} className="rtl:-scale-x-100" />
      </span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  error: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    borderBottom: "1px solid hsl(var(--border) / 0.7)",
    background: "hsl(var(--muted) / 0.25)",
    color: "hsl(var(--muted-foreground))",
    fontSize: 12,
  },
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "8px 12px",
    border: "none",
    borderBottom: "1px solid hsl(var(--border) / 0.7)",
    background: "hsl(var(--primary) / 0.06)",
    color: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "start" as const,
  },
  left: { display: "flex", alignItems: "center", gap: 6 },
  title: { fontWeight: 600 },
  counter: { opacity: 0.65, marginInlineStart: 4 },
  cta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    color: "#60a5fa",
    fontWeight: 500,
  },
};
