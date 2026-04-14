/**
 * <OnboardingPanel /> — the setup checklist that sits above the agent chat.
 *
 * The active step is expanded; completed steps collapse with a green check;
 * remaining steps sit dimmed below. Each method renders differently based on
 * its `kind` (link / form / builder-cli-auth / agent-task).
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconSparkles,
} from "@tabler/icons-react";
import { useOnboarding } from "./use-onboarding.js";
import { sendToAgentChat } from "../agent-chat.js";
import { useDevMode } from "../use-dev-mode.js";
import { getCallbackOrigin } from "../frame.js";
import type {
  OnboardingMethod,
  OnboardingStepStatus,
} from "../../onboarding/types.js";

interface OnboardingPanelProps {
  /** Optional extra styles / classes for the wrapper. */
  className?: string;
  /** Override the built-in title. */
  title?: string;
}

export function OnboardingPanel({
  className,
  title = "Setup",
}: OnboardingPanelProps) {
  const onboarding = useOnboarding();
  const { isDevMode } = useDevMode();
  const {
    steps: rawSteps,
    currentStepId: rawCurrentStepId,
    dismissed,
    loading,
    refresh,
    complete,
    dismiss,
  } = onboarding;
  // `database` and `auth` steps only apply to local dev (SQLite default,
  // local-mode auth bypass). In production those are configured via env
  // vars / deployment config, so don't nag the user about them.
  const DEV_ONLY_STEP_IDS = new Set(["database", "auth"]);
  const steps = isDevMode
    ? rawSteps
    : rawSteps.filter((s) => !DEV_ONLY_STEP_IDS.has(s.id));
  const totalCount = steps.length;
  const completeCount = steps.filter((s) => s.complete).length;
  const allComplete = steps.filter((s) => s.required).every((s) => s.complete);
  const currentStepId = steps.some((s) => s.id === rawCurrentStepId)
    ? rawCurrentStepId
    : (steps.find((s) => s.required && !s.complete)?.id ??
      steps.find((s) => !s.complete)?.id ??
      null);
  // Default expanded when setup is incomplete; collapsed once everything's done.
  const [expanded, setExpanded] = useState(!allComplete);
  const builderEnabled = useBuilderEnabled();

  if (loading || totalCount === 0) return null;
  if (dismissed) return null;
  // Auto-hide once every required step is done — no need to take up sidebar
  // space when there's nothing left to do.
  if (allComplete) return null;

  if (!expanded) {
    return (
      <div className={className} style={styles.compactBanner}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={styles.compactBannerBtn}
          title="Expand setup"
          aria-label="Expand setup"
        >
          <span style={allComplete ? styles.checkDone : styles.checkTodo}>
            {allComplete ? <IconCheck size={12} strokeWidth={3} /> : null}
          </span>
          <span style={styles.headerTitle}>{title}</span>
          <span style={styles.headerCounter}>
            {completeCount} of {totalCount}
          </span>
          <span style={{ marginLeft: "auto", opacity: 0.5, display: "flex" }}>
            <IconChevronDown size={14} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={className} style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {allComplete ? (
            <span style={styles.checkDone}>
              <IconCheck size={12} strokeWidth={3} />
            </span>
          ) : (
            <IconSparkles size={14} style={styles.headerIcon} aria-hidden />
          )}
          <span style={styles.headerTitle}>{title}</span>
          <span style={styles.headerCounter}>
            {completeCount} of {totalCount}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          title="Collapse"
          aria-label="Collapse onboarding"
          style={styles.dismissBtn}
        >
          <IconChevronUp size={14} />
        </button>
      </div>

      <div style={styles.list}>
        {steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            expanded={step.id === currentStepId}
            builderEnabled={builderEnabled}
            onMarkComplete={() => complete(step.id)}
            onRefresh={refresh}
          />
        ))}
      </div>

      <div style={styles.footer}>
        <button type="button" onClick={dismiss} style={styles.hideLink}>
          Hide setup
        </button>
      </div>
    </div>
  );
}

function useBuilderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((keys: Array<{ key: string; configured: boolean }>) => {
        if (keys.find((k) => k.key === "ENABLE_BUILDER")?.configured) {
          setEnabled(true);
        }
      })
      .catch(() => {});
  }, []);
  return enabled;
}

// ─── StepCard ──────────────────────────────────────────────────────────────

function StepCard({
  step,
  expanded: expandedProp,
  builderEnabled,
  onMarkComplete,
  onRefresh,
}: {
  step: OnboardingStepStatus;
  expanded: boolean;
  builderEnabled: boolean;
  onMarkComplete: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(expandedProp);
  useEffect(() => setExpanded(expandedProp), [expandedProp]);

  const isDone = step.complete;
  const sortedMethods = [...step.methods].sort((a, b) => {
    if (!!a.primary === !!b.primary) return 0;
    return a.primary ? -1 : 1;
  });

  return (
    <div
      style={{
        ...styles.card,
        ...(isDone ? styles.cardDone : null),
      }}
    >
      <button
        type="button"
        style={styles.cardHeader}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span style={styles.cardHeaderLeft}>
          <span style={isDone ? styles.checkDone : styles.checkTodo}>
            {isDone ? <IconCheck size={12} strokeWidth={3} /> : null}
          </span>
          <span style={styles.cardTitle}>
            {step.title}
            {step.required && !isDone && (
              <span style={styles.requiredPill}>required</span>
            )}
          </span>
        </span>
        <span style={styles.chevron}>
          {expanded ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
        </span>
      </button>

      {expanded && (
        <div style={styles.cardBody}>
          <p style={styles.cardDesc}>{step.description}</p>
          <div style={styles.methods}>
            {sortedMethods.map((method) => (
              <MethodBlock
                key={method.id}
                method={method}
                stepId={step.id}
                builderEnabled={builderEnabled}
                onCompleted={async () => {
                  await onRefresh();
                }}
                onMarkManualComplete={onMarkComplete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MethodBlock ───────────────────────────────────────────────────────────

function MethodBlock({
  method,
  stepId,
  builderEnabled,
  onCompleted,
  onMarkManualComplete,
}: {
  method: OnboardingMethod;
  stepId: string;
  builderEnabled: boolean;
  onCompleted: () => Promise<void>;
  onMarkManualComplete: () => void;
}) {
  const isBuilder = method.kind === "builder-cli-auth";
  const waitlist = isBuilder && !builderEnabled;
  return (
    <div style={method.primary ? styles.methodPrimary : styles.method}>
      <div style={styles.methodHeader}>
        <span style={styles.methodLabel}>
          {method.label}
          {waitlist ? (
            <span style={badgeStyle("beta")}>coming soon</span>
          ) : (
            method.badge && (
              <span style={badgeStyle(method.badge)}>{method.badge}</span>
            )
          )}
        </span>
      </div>
      {method.description && (
        <p style={styles.methodDesc}>{method.description}</p>
      )}
      <MethodBody
        method={method}
        stepId={stepId}
        waitlist={waitlist}
        onCompleted={onCompleted}
        onMarkManualComplete={onMarkManualComplete}
      />
    </div>
  );
}

function MethodBody({
  method,
  stepId,
  waitlist,
  onCompleted,
  onMarkManualComplete,
}: {
  method: OnboardingMethod;
  stepId: string;
  waitlist: boolean;
  onCompleted: () => Promise<void>;
  onMarkManualComplete: () => void;
}) {
  switch (method.kind) {
    case "link":
      return (
        <LinkMethod method={method} onMarkComplete={onMarkManualComplete} />
      );
    case "form":
      return <FormMethod method={method} onCompleted={onCompleted} />;
    case "builder-cli-auth":
      if (waitlist) return <WaitlistMethod primary={method.primary} />;
      return <BuilderCliAuthMethod onCompleted={onCompleted} />;
    case "agent-task":
      return <AgentTaskMethod method={method} stepId={stepId} />;
  }
}

function WaitlistMethod({ primary }: { primary?: boolean }) {
  return (
    <a
      href="https://www.builder.io/c/waitlist"
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...buttonPrimary(primary), textDecoration: "none" }}
    >
      Join the waitlist
      <IconExternalLink size={12} style={{ marginLeft: 4 }} />
    </a>
  );
}

// ─── link ──────────────────────────────────────────────────────────────────

function LinkMethod({
  method,
  onMarkComplete,
}: {
  method: Extract<OnboardingMethod, { kind: "link" }>;
  onMarkComplete: () => void;
}) {
  const { url, external } = method.payload;
  const isNoop = !url || url === "#";
  if (isNoop) {
    // Sentinel URL — treat as "mark this method as the chosen one".
    return (
      <button
        type="button"
        style={buttonPrimary(method.primary)}
        onClick={onMarkComplete}
      >
        Use this option
      </button>
    );
  }
  return (
    <a
      href={url}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{ ...buttonPrimary(method.primary), textDecoration: "none" }}
    >
      Continue
      {external && <IconExternalLink size={12} style={{ marginLeft: 4 }} />}
    </a>
  );
}

// ─── form ──────────────────────────────────────────────────────────────────

function FormMethod({
  method,
  onCompleted,
}: {
  method: Extract<OnboardingMethod, { kind: "form" }>;
  onCompleted: () => Promise<void>;
}) {
  const { fields, writeScope } = method.payload;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const vars = fields
        .map((f) => ({ key: f.key, value: (values[f.key] ?? "").trim() }))
        .filter((v) => v.value !== "");
      if (vars.length === 0) {
        setErr("Enter a value first.");
        return;
      }
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars, scope: writeScope ?? "workspace" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Save failed: ${res.status}`,
        );
      }
      setValues({});
      await onCompleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {fields.map((f) => (
        <label key={f.key} style={styles.formLabel}>
          <span style={styles.formLabelText}>{f.label}</span>
          <input
            type={f.secret ? "password" : "text"}
            value={values[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
            }
            style={styles.input}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ))}
      {err && <p style={styles.errText}>{err}</p>}
      <button
        type="submit"
        disabled={saving}
        style={{ ...buttonPrimary(method.primary), opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </form>
  );
}

// ─── builder-cli-auth ──────────────────────────────────────────────────────

function BuilderCliAuthMethod({
  onCompleted,
}: {
  onCompleted: () => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cachedConnectUrl, setCachedConnectUrl] = useState<string | null>(null);

  // Pre-fetch the connect URL on mount so the click handler can call
  // window.open synchronously. Any async work between the click and
  // window.open breaks the popup (blockers downgrade to same-tab nav).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const origin = getCallbackOrigin() || window.location.origin;
        const res = await fetch(`${origin}/_agent-native/builder/status`);
        if (!res.ok) return;
        const s = (await res.json()) as { connectUrl?: string };
        if (!cancelled && s.connectUrl) setCachedConnectUrl(s.connectUrl);
      } catch {
        // will fall back to fetching on click
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(() => {
    setConnecting(true);
    setErr(null);
    // Open SYNCHRONOUSLY — user gesture is still active. With noopener
    // the return is null in most browsers, but the new tab still opens.
    if (!cachedConnectUrl) {
      setErr("Still preparing the Builder link — try again in a moment.");
      setConnecting(false);
      return;
    }
    window.open(cachedConnectUrl, "_blank", "noopener,noreferrer");

    const origin = getCallbackOrigin() || window.location.origin;
    // Poll builder status until credentials appear (user finished the flow).
    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${origin}/_agent-native/builder/status`);
        if (!r.ok) return;
        const s = (await r.json()) as { configured: boolean };
        if (s.configured) {
          clearInterval(interval);
          setConnecting(false);
          await onCompleted();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          setConnecting(false);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
  }, [cachedConnectUrl, onCompleted]);

  return (
    <>
      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        style={{ ...buttonPrimary(false), opacity: connecting ? 0.7 : 1 }}
      >
        {connecting ? (
          <>
            <IconLoader2
              size={12}
              style={{ marginRight: 4 }}
              className="animate-spin"
            />
            Waiting for Builder...
          </>
        ) : (
          "Connect Builder"
        )}
      </button>
      {err && <p style={styles.errText}>{err}</p>}
    </>
  );
}

// ─── agent-task ────────────────────────────────────────────────────────────

function AgentTaskMethod({
  method,
  stepId: _stepId,
}: {
  method: Extract<OnboardingMethod, { kind: "agent-task" }>;
  stepId: string;
}) {
  const handleClick = () => {
    sendToAgentChat({ message: method.payload.prompt, submit: true });
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      style={buttonPrimary(method.primary)}
    >
      Ask the agent
    </button>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────

function buttonPrimary(primary: boolean | undefined): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: 6,
    border: primary
      ? "1px solid transparent"
      : "1px solid rgba(255,255,255,0.15)",
    background: primary ? "#3b82f6" : "rgba(255,255,255,0.04)",
    color: primary ? "#fff" : "inherit",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };
}

function badgeStyle(
  kind: "recommended" | "beta" | "free",
): React.CSSProperties {
  const palette = {
    recommended: { bg: "rgba(59,130,246,0.15)", fg: "#60a5fa" },
    beta: { bg: "rgba(168,85,247,0.15)", fg: "#c084fc" },
    free: { bg: "rgba(34,197,94,0.15)", fg: "#4ade80" },
  }[kind];
  return {
    marginLeft: 6,
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 4,
    background: palette.bg,
    color: palette.fg,
    fontWeight: 500,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  };
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
    fontSize: 12,
  },
  compactBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(34,197,94,0.04)",
    fontSize: 12,
  },
  compactBannerBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    padding: "6px 12px",
    flex: 1,
    minWidth: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  headerIcon: { color: "#60a5fa" },
  headerTitle: { fontWeight: 600, fontSize: 12 },
  headerCounter: {
    opacity: 0.5,
    fontSize: 11,
    marginLeft: 4,
  },
  dismissBtn: {
    background: "transparent",
    border: "none",
    color: "inherit",
    opacity: 0.5,
    cursor: "pointer",
    padding: 2,
    display: "flex",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "4px 8px 10px",
  },
  card: {
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    background: "rgba(0,0,0,0.12)",
  },
  cardDone: {
    opacity: 0.55,
  },
  cardHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "transparent",
    border: "none",
    color: "inherit",
    padding: "7px 9px",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  cardHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 500,
  },
  requiredPill: {
    marginLeft: 6,
    fontSize: 10,
    padding: "1px 5px",
    borderRadius: 4,
    background: "rgba(239,68,68,0.12)",
    color: "#f87171",
    fontWeight: 500,
  },
  chevron: { opacity: 0.5 },
  checkDone: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#22c55e",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  checkTodo: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.2)",
  },
  cardBody: {
    padding: "0 10px 10px 34px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  cardDesc: {
    margin: 0,
    opacity: 0.65,
    fontSize: 12,
    lineHeight: 1.4,
  },
  methods: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  method: {
    padding: "8px 10px",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    background: "rgba(255,255,255,0.02)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  methodPrimary: {
    padding: "10px",
    border: "1px solid rgba(59,130,246,0.25)",
    borderRadius: 6,
    background: "rgba(59,130,246,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  methodHeader: { display: "flex", alignItems: "center" },
  methodLabel: { fontSize: 12, fontWeight: 500 },
  methodDesc: { margin: 0, opacity: 0.6, fontSize: 11, lineHeight: 1.4 },
  form: { display: "flex", flexDirection: "column", gap: 6 },
  formLabel: { display: "flex", flexDirection: "column", gap: 2 },
  formLabelText: { fontSize: 11, opacity: 0.6 },
  input: {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  errText: { margin: 0, fontSize: 11, color: "#f87171" },
  footer: {
    padding: "0 12px 10px",
    display: "flex",
    justifyContent: "flex-end",
  },
  hideLink: {
    background: "transparent",
    border: "none",
    color: "inherit",
    opacity: 0.5,
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 4px",
  },
};
