/**
 * Onboarding preview — read-only render of the registered onboarding steps
 * with completion forced to false. Used by the framework's built-in dev
 * panel so template authors can see what a brand-new user would see without
 * actually resetting their own setup.
 */

import { useCallback, useEffect, useState } from "react";
import {
  IconCircle,
  IconLink,
  IconLoader2,
  IconPlugConnected,
  IconRefresh,
  IconRobot,
  IconSettings,
} from "@tabler/icons-react";
import type {
  OnboardingMethod,
  OnboardingStepStatus,
} from "../../onboarding/types.js";

export function OnboardingPreview() {
  const [steps, setSteps] = useState<OnboardingStepStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/_agent-native/onboarding/steps?preview=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OnboardingStepStatus[];
      setSteps(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load steps");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && steps.length === 0) {
    return (
      <div style={styles.placeholder}>
        <IconLoader2
          size={14}
          style={{ animation: "spin 1s linear infinite" }}
        />
        Loading onboarding steps…
      </div>
    );
  }

  if (error) {
    return <div style={styles.error}>Couldn't load onboarding: {error}</div>;
  }

  if (steps.length === 0) {
    return (
      <div style={styles.placeholder}>
        No onboarding steps registered for this app.
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.intro}>
        Read-only preview — what a new user sees. No state is mutated.
      </div>
      {steps.map((step, i) => (
        <StepCard key={step.id} step={step} index={i + 1} />
      ))}
      <button type="button" style={styles.refreshBtn} onClick={load}>
        <IconRefresh size={12} />
        Refresh
      </button>
    </div>
  );
}

function StepCard({
  step,
  index,
}: {
  step: OnboardingStepStatus;
  index: number;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardIndex}>
          <IconCircle size={14} />
          <span style={styles.cardIndexNum}>{index}</span>
        </span>
        <div style={styles.cardTitle}>{step.title}</div>
        {step.required && <span style={styles.requiredPill}>required</span>}
      </div>
      <div style={styles.cardDesc}>{step.description}</div>
      <div style={styles.methods}>
        {step.methods.map((m) => (
          <MethodRow key={m.id} method={m} />
        ))}
      </div>
    </div>
  );
}

function MethodRow({ method }: { method: OnboardingMethod }) {
  const Icon =
    method.kind === "link"
      ? IconLink
      : method.kind === "form"
        ? IconSettings
        : method.kind === "agent-task"
          ? IconRobot
          : IconPlugConnected;
  return (
    <div style={styles.methodRow}>
      <Icon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      <div style={styles.methodLabel}>
        <span>{method.label}</span>
        {method.badge && <span style={styles.badge}>{method.badge}</span>}
        {method.primary && <span style={styles.primaryDot} title="Primary" />}
      </div>
      <span style={styles.methodKind}>{method.kind}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", flexDirection: "column", gap: 8 },
  intro: { fontSize: 11, opacity: 0.6, marginBottom: 4 },
  placeholder: {
    fontSize: 12,
    opacity: 0.7,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  error: {
    fontSize: 12,
    color: "#fecaca",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 6,
    padding: 8,
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  cardHeader: { display: "flex", alignItems: "center", gap: 8 },
  cardIndex: {
    position: "relative",
    width: 18,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
  },
  cardIndexNum: {
    position: "absolute",
    fontSize: 9,
    fontWeight: 700,
  },
  cardTitle: { fontSize: 13, fontWeight: 600, flex: 1 },
  cardDesc: { fontSize: 11, opacity: 0.65, lineHeight: 1.4 },
  requiredPill: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background: "rgba(239,68,68,0.15)",
    color: "#fecaca",
    padding: "2px 6px",
    borderRadius: 4,
    fontWeight: 600,
  },
  methods: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  methodRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 5,
    padding: "5px 7px",
  },
  methodLabel: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  methodKind: {
    fontSize: 10,
    opacity: 0.5,
    fontFamily: "ui-monospace, monospace",
  },
  badge: {
    fontSize: 9,
    background: "rgba(34,197,94,0.15)",
    color: "#bbf7d0",
    padding: "1px 5px",
    borderRadius: 3,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  primaryDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#3b82f6",
    flexShrink: 0,
  },
  refreshBtn: {
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 5,
    padding: "3px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
};
