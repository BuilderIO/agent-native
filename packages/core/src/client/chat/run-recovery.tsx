// Owns: run-error metadata extractors, recovery helpers, RunErrorRecoveryCard,
// LoopLimitContinueCard, BuilderConnectCta, BuilderSetupCard, ApiKeyConnect,
// PlanModeCallout, and getLoopLimitMetadata / getRunErrorMetadata exports used
// by AssistantChatInner.

import {
  IconLoader2,
  IconCheck,
  IconCopy,
  IconX,
  IconChevronDown,
  IconGitFork,
  IconGauge,
  IconSettings,
  IconArrowRight,
  IconAlertTriangle,
  IconPlayerPlay,
  IconRefresh,
  IconPlus,
  IconClipboardList,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef } from "react";

import { agentNativePath } from "../api-path.js";
import { writeClipboardText } from "../clipboard.js";
import {
  isProviderAuthenticationError,
  localizeKnownChatErrorText,
} from "../error-format.js";
import { useFormatters, useT } from "../i18n.js";
import { AgentProviderSetupForm } from "../settings/ProviderSetupForm.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";

// ─── Type definitions ─────────────────────────────────────────────────────────

export type LoopLimitInfo = { maxIterations?: number };

export type RunErrorInfo = {
  message: string;
  details?: string;
  errorCode?: string;
  runId?: string;
  turnId?: string;
  recoverable?: boolean;
};

interface AgentLoopSettingsResponse {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  scope: "org" | "user" | "default";
  source: "org" | "user" | "env" | "default";
  canUpdate: boolean;
  orgName?: string | null;
  role?: string | null;
}

// ─── Metadata extractors ──────────────────────────────────────────────────────

export function getLoopLimitMetadata(message: unknown): LoopLimitInfo | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { loopLimit?: LoopLimitInfo };
        loopLimit?: LoopLimitInfo;
      }
    | undefined;
  const loopLimit = meta?.custom?.loopLimit ?? meta?.loopLimit;
  if (!loopLimit || typeof loopLimit !== "object") return null;
  return {
    ...(typeof loopLimit.maxIterations === "number"
      ? { maxIterations: loopLimit.maxIterations }
      : {}),
  };
}

export function getRunErrorMetadata(message: unknown): RunErrorInfo | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { runError?: RunErrorInfo; runId?: unknown; turnId?: unknown };
        runError?: RunErrorInfo;
        runId?: unknown;
        turnId?: unknown;
      }
    | undefined;
  const runError = meta?.custom?.runError ?? meta?.runError;
  if (!runError || typeof runError !== "object") return null;
  const messageText =
    typeof runError.message === "string" ? runError.message : "";
  if (!messageText) return null;
  const runId =
    typeof runError.runId === "string"
      ? runError.runId
      : typeof meta?.custom?.runId === "string"
        ? meta.custom.runId
        : typeof meta?.runId === "string"
          ? meta.runId
          : undefined;
  const turnId =
    typeof runError.turnId === "string"
      ? runError.turnId
      : typeof meta?.custom?.turnId === "string"
        ? meta.custom.turnId
        : typeof meta?.turnId === "string"
          ? meta.turnId
          : undefined;
  return {
    message: messageText,
    ...(typeof runError.details === "string"
      ? { details: runError.details }
      : {}),
    ...(typeof runError.errorCode === "string"
      ? { errorCode: runError.errorCode }
      : {}),
    ...(runId ? { runId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(runError.recoverable ? { recoverable: true } : {}),
  };
}

/**
 * Identity of one failure, shared by the banner and the inline turn marker so
 * the same run is never announced twice.
 */
export function runErrorKey(info: RunErrorInfo): string {
  return `${info.runId ?? ""}:${info.errorCode ?? ""}:${info.message}`;
}

export function runErrorHeadline(
  info: RunErrorInfo,
  labels: {
    recoverable: string;
    terminal: string;
  } = {
    recoverable: "The agent stopped before finishing",
    terminal: "The agent hit an error",
  },
): string {
  return info.recoverable === true ? labels.recoverable : labels.terminal;
}

export function getRequestModeMetadata(
  message: unknown,
): "act" | "plan" | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { requestMode?: unknown };
        requestMode?: unknown;
      }
    | undefined;
  const requestMode = meta?.custom?.requestMode ?? meta?.requestMode;
  return requestMode === "act" || requestMode === "plan" ? requestMode : null;
}

// ─── Run error classifiers ────────────────────────────────────────────────────

function isBuilderReconnectRunError(info: RunErrorInfo): boolean {
  const code = (info.errorCode ?? "").toLowerCase();
  const message = info.message.toLowerCase();
  const isAuthCode =
    code === "authentication_error" ||
    code === "unauthorized" ||
    code === "http_401" ||
    code === "http_403";
  return (
    code === "builder_auth_error" ||
    message.includes("builder authentication failed") ||
    (isAuthCode &&
      (message.includes("invalid token") ||
        message.includes("personal access token")))
  );
}

function isProviderQueryRunError(info: RunErrorInfo): boolean {
  const text = [info.errorCode, info.message, info.details]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("bigquery") ||
    text.includes("sql") ||
    text.includes("query") ||
    text.includes("schema") ||
    text.includes("syntax") ||
    text.includes("unknown column") ||
    text.includes("unknown table") ||
    text.includes("type mismatch")
  );
}

function isConnectionRecoveryRunError(info: RunErrorInfo): boolean {
  const code = (info.errorCode ?? "").toLowerCase();
  const message = info.message.toLowerCase();
  return (
    code === "connection_error" ||
    message.includes("connection kept failing") ||
    message.includes("automatic recovery attempts")
  );
}

// ─── BuilderConnectCta ────────────────────────────────────────────────────────
// Renders a single row with left-aligned copy and a right-aligned action.
// Click opens the Builder CLI-auth popup via the shared
// `useBuilderConnectFlow` hook (which owns the synchronous window.open,
// the 2s status poll, and the focus-refresh). On success the hook broadcasts
// a config-change event so the chat clears its local `missingApiKey` gate.
//
// Desktop note: when this component runs inside the Electron shell, the
// window.open call is intercepted by the main process's webview popup handler,
// which opens the flow in an Electron BrowserWindow that shares the webview's
// session. See packages/desktop-app/src/main/index.ts.

export function BuilderConnectCta({
  variant = "primary",
  onConnected,
}: {
  variant?: "primary" | "compact";
  onConnected?: () => void;
}) {
  const t = useT();
  const { configured, orgName, connecting, error, start } =
    useBuilderConnectFlow({
      trackingSource: "assistant_chat_builder_cta",
      onConnected,
    });

  if (variant === "compact") {
    if (configured) {
      return (
        <span className="agent-builder-setup-card__builder-button inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground">
          <IconCheck size={11} className="text-emerald-500" />
          {orgName
            ? t("agentChat.setup.connectedTo", { organization: orgName })
            : t("agentChat.setup.connected")}
        </span>
      );
    }

    return (
      <div className="agent-builder-setup-card__builder-cta flex min-w-0 flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          onClick={() => start()}
          disabled={connecting}
          className="agent-builder-setup-card__builder-button inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-foreground px-3 text-[11px] font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          aria-busy={connecting}
        >
          {connecting ? (
            <>
              <IconLoader2 size={10} className="animate-spin" />
              {t("agentChat.common.waiting")}
            </>
          ) : (
            t("agentChat.setup.connectBuilder")
          )}
        </button>
        {error && (
          <p className="max-w-[13rem] text-[10px] leading-snug text-destructive sm:text-end">
            {error}
          </p>
        )}
      </div>
    );
  }

  const containerClass =
    "flex items-center gap-3 rounded-md border border-border px-3 py-3";

  if (configured) {
    return (
      <div className={containerClass}>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">Builder.io</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {orgName
              ? t("agentChat.setup.connectedOrganization", {
                  organization: orgName,
                })
              : t("agentChat.setup.connected")}
          </p>
        </div>
        <span className="ms-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
          <IconCheck size={10} />
          {t("agentChat.setup.connected")}
        </span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">
          {t("agentChat.setup.connectBuilder")}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[220px]">
          {t("agentChat.setup.freeCredits")}
        </p>
        {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
      </div>
      <button
        type="button"
        onClick={() => start()}
        disabled={connecting}
        className="ms-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium no-underline text-background hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
        aria-busy={connecting}
      >
        {connecting ? (
          <>
            <IconLoader2 size={10} className="animate-spin" />
            {t("agentChat.common.waiting")}
          </>
        ) : (
          t("agentChat.common.connect")
        )}
      </button>
    </div>
  );
}

// ─── ApiKeyConnect ────────────────────────────────────────────────────────────

export function ApiKeyConnect({ onConnected }: { onConnected?: () => void }) {
  return (
    <AgentProviderSetupForm
      onConnected={() => onConnected?.()}
      layout="compact"
      showTitle={false}
    />
  );
}

// ─── BuilderSetupCard ─────────────────────────────────────────────────────────

export type BuilderSetupCardLayout = "default" | "sidebar";

export function BuilderSetupContent({
  onConnected,
  layout = "default",
}: {
  onConnected?: () => void;
  layout?: BuilderSetupCardLayout;
}) {
  const t = useT();
  const [keyOpen, setKeyOpen] = useState(false);
  const sidebarLayout = layout === "sidebar";

  return (
    <div
      className={cn(
        "agent-builder-setup-content",
        sidebarLayout && "agent-builder-setup-card--sidebar",
      )}
    >
      <div
        className={cn(
          "agent-builder-setup-card__content flex flex-col sm:flex-row sm:items-center sm:justify-between",
          sidebarLayout ? "gap-2" : "gap-3",
        )}
      >
        <div className="agent-builder-setup-card__copy min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">
            {t("agentPanel.connectAi", { defaultValue: "Connect AI" })}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("agentPanel.builderOrOwnKeys", {
              defaultValue: "Choose Builder.io or custom keys.",
            })}
          </p>
        </div>
        <div
          className={cn(
            "agent-builder-setup-card__actions flex shrink-0",
            sidebarLayout
              ? "flex-row items-center gap-1"
              : "flex-nowrap items-center gap-2",
          )}
        >
          <BuilderConnectCta variant="compact" onConnected={onConnected} />
          <button
            type="button"
            onClick={() => setKeyOpen((open) => !open)}
            className={cn(
              "agent-builder-setup-card__key-button inline-flex shrink-0 items-center whitespace-nowrap rounded-md text-[11px] font-medium",
              sidebarLayout
                ? "h-7 border-0 bg-transparent px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                : "h-8 border border-border bg-background px-3 text-foreground hover:bg-accent",
            )}
            aria-expanded={keyOpen}
          >
            {t("agentPanel.addOwnKeys", {
              defaultValue: "Custom keys",
            })}
          </button>
        </div>
      </div>

      {keyOpen ? (
        <div className="mt-3">
          <ApiKeyConnect onConnected={onConnected} />
        </div>
      ) : null}
    </div>
  );
}

export function BuilderSetupCard({
  onConnected,
  bouncePulse,
  attached = false,
  fullWidth,
  layout = "default",
}: {
  onConnected?: () => void;
  bouncePulse?: number;
  attached?: boolean;
  fullWidth?: boolean;
  layout?: BuilderSetupCardLayout;
}) {
  const sidebarLayout = layout === "sidebar";

  const cardRef = useRef<HTMLDivElement>(null);
  // Replay the bounce keyframe each time bouncePulse increments. Toggling the
  // class off-then-on (with a forced reflow) restarts the animation even when
  // the value changes back-to-back.
  useEffect(() => {
    if (!bouncePulse) return;
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("animate-bounce-once");
    void el.offsetWidth;
    el.classList.add("animate-bounce-once");
  }, [bouncePulse]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "agent-builder-setup-card",
        sidebarLayout && "agent-builder-setup-card--sidebar",
        attached && "agent-builder-setup-card--attached",
        fullWidth
          ? "w-full px-3 pb-2"
          : sidebarLayout
            ? "mx-auto w-full max-w-[42rem] px-3 pb-2"
            : "mx-auto w-full max-w-[42rem] px-3 pb-2 sm:w-fit",
      )}
    >
      <div
        className={cn(
          "agent-builder-setup-card__panel rounded-lg border border-border/80 bg-background/80 shadow-sm backdrop-blur",
          sidebarLayout ? "p-2.5" : "p-3",
        )}
      >
        <BuilderSetupContent onConnected={onConnected} layout={layout} />
      </div>
    </div>
  );
}

// ─── RunErrorRecoveryCard ─────────────────────────────────────────────────────

export function RunErrorRecoveryCard({
  info,
  onContinue,
  onRetry,
  onFork,
  onDismiss,
  onProviderConnected,
}: {
  info: RunErrorInfo;
  onContinue: () => void;
  onRetry: () => void;
  onFork?: () => void | boolean | Promise<void | boolean>;
  onDismiss: () => void;
  onProviderConnected?: () => void;
}) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const builderReconnect = useBuilderConnectFlow({
    trackingSource: "assistant_chat_reconnect_error",
  });
  const canRecover = info.recoverable === true;
  const shouldShowBuilderReconnect = isBuilderReconnectRunError(info);
  const isProviderAuthError = isProviderAuthenticationError(
    [info.message, info.details].filter(Boolean).join("\n"),
    info.errorCode,
  );
  // Blocked on something the reader goes and fixes elsewhere, then comes back
  // to. Without a retry the card is a dead end and its own copy ("then retry")
  // points at a button that isn't there.
  const isUnblockableExternally =
    info.errorCode === "email_verification_required";
  const canRetry = canRecover || isProviderAuthError || isUnblockableExternally;
  const builderReconnectResolved =
    shouldShowBuilderReconnect &&
    builderReconnect.hasFetchedStatus &&
    builderReconnect.configured;
  const isQueryError = isProviderQueryRunError(info);
  const isConnectionRecoveryError = isConnectionRecoveryRunError(info);
  const copyLabel =
    info.runId || info.errorCode || info.details
      ? t("agentChat.recovery.copyDebug")
      : t("agentChat.common.copy");
  const copyDetails = useCallback(() => {
    const text = [
      info.message,
      info.errorCode ? `Code: ${info.errorCode}` : "",
      info.runId ? `Run: ${info.runId}` : "",
      info.details ? `Details:\n${info.details}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    void writeClipboardText(text)
      .then((ok) => {
        setCopyState(ok ? "copied" : "failed");
        setTimeout(() => setCopyState("idle"), 1600);
      })
      .catch(() => {
        setCopyState("failed");
        setTimeout(() => setCopyState("idle"), 1600);
      });
  }, [info]);
  const startNewChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("agent-chat:new-chat"));
    onDismiss();
  }, [onDismiss]);

  const handleProviderConnected = useCallback(() => {
    onProviderConnected?.();
    onRetry();
    onDismiss();
  }, [onDismiss, onProviderConnected, onRetry]);

  const handleFork = useCallback(async () => {
    if (!onFork || forking) return;
    setForking(true);
    setForkError(null);
    try {
      const result = await onFork();
      if (result === false) {
        setForkError(t("agentChat.recovery.forkFailed"));
      }
    } catch {
      setForkError(t("agentChat.recovery.forkFailed"));
    } finally {
      setForking(false);
    }
  }, [forking, onFork, t]);

  useEffect(() => {
    if (builderReconnectResolved) {
      onDismiss();
    }
  }, [builderReconnectResolved, onDismiss]);

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <IconAlertTriangle size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            {runErrorHeadline(info, {
              recoverable: t("agentChat.error.stopped"),
              terminal: t("agentChat.error.failed"),
            })}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {localizeKnownChatErrorText(info.message, t)}
          </p>
          {isProviderAuthError && (
            <div className="mt-3 rounded-md border border-border/70 bg-background/60 p-2.5">
              <BuilderSetupContent
                layout="sidebar"
                onConnected={handleProviderConnected}
              />
            </div>
          )}
          {shouldShowBuilderReconnect && !builderReconnectResolved && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("agentChat.recovery.credentialRejected")}
            </p>
          )}
          {isConnectionRecoveryError && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("agentChat.recovery.newChatHint")}
            </p>
          )}
          {(info.runId || info.errorCode || info.details) && (
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <IconChevronDown
                size={12}
                className={cn(
                  "transition-transform",
                  detailsOpen && "rotate-180",
                )}
              />
              {t("agentChat.common.details")}
            </button>
          )}
          {detailsOpen && (
            <div className="mt-2 rounded-md border border-border/60 bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {info.runId && <div>run: {info.runId}</div>}
              {info.errorCode && <div>code: {info.errorCode}</div>}
              {info.details && (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono">
                  {info.details}
                </pre>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("agentChat.common.dismiss")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground"
        >
          <IconX size={14} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {shouldShowBuilderReconnect && !builderReconnectResolved && (
          <button
            type="button"
            onClick={() => builderReconnect.start()}
            disabled={builderReconnect.connecting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
          >
            {builderReconnect.connecting ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : null}
            {builderReconnect.connecting
              ? t("agentChat.recovery.connectingBuilder")
              : t("agentChat.recovery.reconnectBuilder")}
          </button>
        )}
        {canRecover && (
          <>
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
            >
              <IconPlayerPlay size={13} />
              {t("agentChat.common.continue")}
            </button>
          </>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconRefresh size={13} />
            {isQueryError
              ? t("agentChat.recovery.diagnoseRetry")
              : t("agentChat.common.retry")}
          </button>
        )}
        {canRecover && isConnectionRecoveryError && (
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconPlus size={13} />
            {t("agentChat.tabs.newChat")}
          </button>
        )}
        {canRecover && onFork && !isConnectionRecoveryError && (
          <button
            type="button"
            onClick={handleFork}
            disabled={forking}
            title={t("agentChat.recovery.forkDescription")}
            aria-label={t("agentChat.recovery.forkDescription")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-70"
          >
            {forking ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconGitFork size={13} />
            )}
            {forking
              ? t("agentChat.recovery.forking")
              : t("agentChat.message.forkChat")}
          </button>
        )}
        <button
          type="button"
          onClick={copyDetails}
          className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-background/80 hover:text-foreground"
        >
          {copyState === "copied" ? (
            <IconCheck size={13} />
          ) : copyState === "failed" ? (
            <IconX size={13} />
          ) : (
            <IconCopy size={13} />
          )}
          <span aria-live="polite">
            {copyState === "copied"
              ? t("agentChat.common.copied")
              : copyState === "failed"
                ? t("agentChat.recovery.copyFailed")
                : copyLabel}
          </span>
        </button>
      </div>
      {shouldShowBuilderReconnect && builderReconnect.error && (
        <p className="mt-2 text-xs leading-relaxed text-red-500">
          {builderReconnect.error}
        </p>
      )}
      {forkError && (
        <p className="mt-2 text-xs leading-relaxed text-red-500">{forkError}</p>
      )}
    </div>
  );
}

// ─── LoopLimitContinueCard ────────────────────────────────────────────────────

export function LoopLimitContinueCard({
  info,
  onContinue,
}: {
  info: LoopLimitInfo;
  onContinue: () => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const [settings, setSettings] = useState<AgentLoopSettingsResponse | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/agent-loop-settings"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AgentLoopSettingsResponse | null) => {
        if (cancelled || !data) return;
        setSettings(data);
        setValue(String(data.maxIterations));
      })
      .catch(() => {
        if (!cancelled) setValue(String(info.maxIterations ?? ""));
      });
    return () => {
      cancelled = true;
    };
  }, [info.maxIterations]);

  useEffect(() => load(), [load]);

  const currentLimit = settings?.maxIterations ?? info.maxIterations;
  const numericValue = Number(value);
  const hasPendingChange =
    !!settings &&
    settings.canUpdate &&
    Number.isInteger(numericValue) &&
    numericValue !== settings.maxIterations;
  const scopeLabel =
    settings?.scope === "org"
      ? settings.orgName
        ? t("agentChat.limit.namedOrganization", {
            organization: settings.orgName,
          })
        : t("agentChat.limit.organization")
      : t("agentChat.limit.account");

  const saveLimit = useCallback(async (): Promise<boolean> => {
    if (!settings?.canUpdate) return false;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-loop-settings"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxIterations: numericValue }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ??
            t("agentChat.common.saveFailedStatus", { status: res.status }),
        );
      }
      setSettings(body as AgentLoopSettingsResponse);
      setValue(String((body as AgentLoopSettingsResponse).maxIterations));
      setSaved(true);
      window.dispatchEvent(
        new CustomEvent("agent-loop-settings:changed", { detail: body }),
      );
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("agentChat.common.saveFailed"),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [numericValue, settings?.canUpdate, t]);

  const handleContinue = useCallback(async () => {
    if (hasPendingChange) {
      const ok = await saveLimit();
      if (!ok) return;
    }
    onContinue();
  }, [hasPendingChange, onContinue, saveLimit]);

  const openSettings = useCallback(() => {
    try {
      window.location.hash = "agent-limits";
    } catch {}
    window.dispatchEvent(new CustomEvent("agent-panel:open-settings"));
  }, []);

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <IconGauge size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("agentChat.limit.reached")}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {currentLimit
              ? t("agentChat.limit.descriptionWithCount", {
                  count: currentLimit,
                  formattedCount: formatNumber(currentLimit),
                  scope: scopeLabel,
                })
              : t("agentChat.limit.descriptionAll", { scope: scopeLabel })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[116px] flex-1 space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("agentChat.limit.maxSteps")}
          </span>
          <input
            type="number"
            min={settings?.minMaxIterations ?? 1}
            max={settings?.maxMaxIterations ?? 1000}
            value={value}
            disabled={!settings?.canUpdate || saving}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={saveLimit}
          disabled={!hasPendingChange || saving}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {saving ? (
            <IconLoader2 size={12} className="animate-spin" />
          ) : saved ? (
            <IconCheck size={12} />
          ) : (
            t("agentChat.common.save")
          )}
        </button>
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconSettings size={12} />
          {t("agentChat.common.settings")}
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className="ms-auto inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {hasPendingChange
            ? t("agentChat.limit.saveAndContinue")
            : t("agentChat.limit.keepGoing")}
          <IconArrowRight size={12} />
        </button>
      </div>

      {settings && !settings.canUpdate && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("agentChat.limit.ownerOnly")}
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ─── PlanModeCallout ──────────────────────────────────────────────────────────
//
// Renders inside the same width-constrained column as the composer (see
// `.agent-plan-mode-callout` in agent-native.css and the fullscreen rule
// injected by AgentPanel) so the pill hugs the composer's right edge in both
// narrow sidebar chats and wide/centered page layouts, instead of floating
// against the full pane width.

export function PlanModeCallout({
  canImplementPlan,
  onImplementPlan,
  onSwitchToAct,
}: {
  canImplementPlan: boolean;
  onImplementPlan: () => void;
  onSwitchToAct: () => void;
}) {
  const t = useT();
  return (
    <div className="agent-plan-mode-callout shrink-0 px-3">
      <div className="ms-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/95 px-2 py-1.5 text-xs text-muted-foreground shadow-sm">
        <IconClipboardList size={13} className="shrink-0" />
        <span className="min-w-0 truncate">
          {canImplementPlan
            ? t("agentChat.plan.ready")
            : t("agentChat.plan.mode")}
        </span>
        {canImplementPlan ? (
          <button
            type="button"
            onClick={onImplementPlan}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background hover:opacity-90"
          >
            <IconPlayerPlay size={12} />
            {t("agentChat.plan.implement")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSwitchToAct}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-accent"
            aria-label={t("agentChat.plan.switchToAct")}
          >
            {t("agentChat.plan.act")}
            <IconArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
