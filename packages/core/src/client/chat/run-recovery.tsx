// Owns: run-error metadata extractors, recovery helpers, RunErrorRecoveryCard,
// LoopLimitContinueCard, BuilderConnectCta, BuilderSetupCard, ApiKeyConnect,
// PlanModeCallout, and getLoopLimitMetadata / getRunErrorMetadata exports used
// by AssistantChatInner.

import { useState, useEffect, useCallback, useRef } from "react";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import {
  saveAgentEngineApiKey,
  type AgentEngineProvider,
} from "../agent-engine-key.js";
import { cn } from "../utils.js";
import { writeClipboardText } from "../clipboard.js";
import { agentNativePath } from "../api-path.js";
import {
  IconLoader2,
  IconCheck,
  IconCopy,
  IconX,
  IconChevronDown,
  IconExternalLink,
  IconKey,
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

// ─── Type definitions ─────────────────────────────────────────────────────────

export type LoopLimitInfo = { maxIterations?: number };

export type RunErrorInfo = {
  message: string;
  details?: string;
  errorCode?: string;
  runId?: string;
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
        custom?: { runError?: RunErrorInfo; runId?: unknown };
        runError?: RunErrorInfo;
        runId?: unknown;
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
  return {
    message: messageText,
    ...(typeof runError.details === "string"
      ? { details: runError.details }
      : {}),
    ...(typeof runError.errorCode === "string"
      ? { errorCode: runError.errorCode }
      : {}),
    ...(runId ? { runId } : {}),
    ...(runError.recoverable ? { recoverable: true } : {}),
  };
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
  const { configured, orgName, connecting, error, start } =
    useBuilderConnectFlow({
      trackingSource: "assistant_chat_builder_cta",
      onConnected,
    });

  if (variant === "compact") {
    if (configured) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground">
          <IconCheck size={11} className="text-emerald-500" />
          {orgName ? `Connected to ${orgName}` : "Connected"}
        </span>
      );
    }

    return (
      <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          onClick={() => start()}
          disabled={connecting}
          className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-foreground px-3 text-[11px] font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          aria-busy={connecting}
        >
          {connecting ? (
            <>
              <IconLoader2 size={10} className="animate-spin" />
              Waiting…
            </>
          ) : (
            "Connect Builder.io"
          )}
        </button>
        {error && (
          <p className="max-w-[13rem] text-[10px] leading-snug text-destructive sm:text-right">
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
            {orgName ? `Connected — ${orgName}` : "Connected"}
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
          <IconCheck size={10} />
          Connected
        </span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">
          Connect Builder.io
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[220px]">
          Free credits for LLM, hosting, and more — no API key needed
        </p>
        {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
      </div>
      <button
        type="button"
        onClick={() => start()}
        disabled={connecting}
        className="ml-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium no-underline text-background hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
        aria-busy={connecting}
      >
        {connecting ? (
          <>
            <IconLoader2 size={10} className="animate-spin" />
            Waiting…
          </>
        ) : (
          <>
            Connect
            <IconExternalLink size={10} />
          </>
        )}
      </button>
    </div>
  );
}

// ─── ApiKeyConnect ────────────────────────────────────────────────────────────

const API_KEY_PROVIDERS: Array<{
  value: AgentEngineProvider;
  label: string;
  placeholder: string;
}> = [
  { value: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", placeholder: "sk-…" },
];

export function ApiKeyConnect({ onConnected }: { onConnected?: () => void }) {
  const [provider, setProvider] = useState<AgentEngineProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = API_KEY_PROVIDERS.find((p) => p.value === provider)!;

  const handleSave = useCallback(async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveAgentEngineApiKey({ provider, apiKey });
      setApiKey("");
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }, [apiKey, onConnected, provider, saving]);

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <IconKey size={12} strokeWidth={1.9} />
        Use your own API key
      </div>
      <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Stored securely for this app only.
      </p>
      <div
        role="tablist"
        aria-label="API key provider"
        className="mb-2 inline-flex rounded-md border border-border bg-muted/40 p-0.5"
      >
        {API_KEY_PROVIDERS.map((option) => {
          const selected = option.value === provider;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setProvider(option.value);
                setError(null);
              }}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={active.placeholder}
          onChange={(e) => {
            setApiKey(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!apiKey.trim() || saving}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-foreground px-3 text-[11px] font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <IconLoader2 size={11} className="animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

// ─── BuilderSetupCard ─────────────────────────────────────────────────────────

export type BuilderSetupCardLayout = "default" | "sidebar";

export function BuilderSetupCard({
  onConnected,
  bouncePulse,
  fullWidth,
  layout = "default",
}: {
  onConnected?: () => void;
  bouncePulse?: number;
  fullWidth?: boolean;
  layout?: BuilderSetupCardLayout;
}) {
  // Progressive disclosure: the card leads with one-click Builder connect while
  // keeping the bring-your-own-key path close by.
  const [keyOpen, setKeyOpen] = useState(false);
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
        fullWidth
          ? "w-full pb-2"
          : sidebarLayout
            ? "mx-auto w-full max-w-[42rem] px-3 pb-2"
            : "mx-auto w-full max-w-[42rem] px-3 pb-2 sm:w-fit",
      )}
    >
      <div className="rounded-lg border border-border/80 bg-background/80 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium text-foreground">
              Connect AI
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Use Builder.io (free credits), or add an Anthropic/OpenAI key.
            </p>
          </div>
          <div
            className={cn(
              "flex shrink-0",
              sidebarLayout
                ? "flex-col items-start gap-0 sm:items-center"
                : "flex-nowrap items-center gap-2",
            )}
          >
            <BuilderConnectCta variant="compact" onConnected={onConnected} />
            <button
              type="button"
              onClick={() => setKeyOpen((open) => !open)}
              className={cn(
                "inline-flex shrink-0 items-center whitespace-nowrap rounded-md text-[11px] font-medium",
                sidebarLayout
                  ? "h-7 border-0 bg-transparent px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  : "h-8 border border-border bg-background px-3 text-foreground hover:bg-accent",
              )}
              aria-expanded={keyOpen}
            >
              {sidebarLayout ? "Or, use API key" : "Use API key"}
            </button>
          </div>
        </div>

        {keyOpen ? (
          <div className="mt-3">
            <ApiKeyConnect onConnected={onConnected} />
          </div>
        ) : null}
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
}: {
  info: RunErrorInfo;
  onContinue: () => void;
  onRetry: () => void;
  onFork?: () => void | boolean | Promise<void | boolean>;
  onDismiss: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const builderReconnect = useBuilderConnectFlow({
    trackingSource: "assistant_chat_reconnect_error",
  });
  const canRecover = info.recoverable === true;
  const shouldShowBuilderReconnect = isBuilderReconnectRunError(info);
  const builderReconnectResolved =
    shouldShowBuilderReconnect &&
    builderReconnect.hasFetchedStatus &&
    builderReconnect.configured;
  const isQueryError = isProviderQueryRunError(info);
  const isConnectionRecoveryError = isConnectionRecoveryRunError(info);
  const copyLabel =
    info.runId || info.errorCode || info.details ? "Copy debug" : "Copy";
  const copyDetails = useCallback(() => {
    const text = [
      info.message,
      info.errorCode ? `Code: ${info.errorCode}` : "",
      info.runId ? `Run: ${info.runId}` : "",
      info.details ? `Details:\n${info.details}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    void writeClipboardText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [info]);
  const startNewChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("agent-chat:new-chat"));
    onDismiss();
  }, [onDismiss]);

  const handleFork = useCallback(async () => {
    if (!onFork || forking) return;
    setForking(true);
    setForkError(null);
    try {
      const result = await onFork();
      if (result === false) {
        setForkError("Could not fork this chat. Try starting a new chat.");
      }
    } catch {
      setForkError("Could not fork this chat. Try starting a new chat.");
    } finally {
      setForking(false);
    }
  }, [forking, onFork]);

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
            {canRecover
              ? "The agent stopped before finishing"
              : "The agent hit an error"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {info.message}
          </p>
          {shouldShowBuilderReconnect && !builderReconnectResolved && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The current Builder.io or model-provider credential was rejected.
              Reconnect Builder.io, then retry this message.
            </p>
          )}
          {isConnectionRecoveryError && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              If retry lands on the same error, start a new chat session and
              continue from what already changed.
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
              Details
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
          aria-label="Dismiss"
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
            ) : (
              <IconExternalLink size={13} />
            )}
            {builderReconnect.connecting
              ? "Connecting Builder.io"
              : "Reconnect Builder.io"}
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
              Continue
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              <IconRefresh size={13} />
              {isQueryError ? "Diagnose and retry" : "Retry"}
            </button>
          </>
        )}
        {canRecover && isConnectionRecoveryError && (
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconPlus size={13} />
            New chat
          </button>
        )}
        {canRecover && onFork && !isConnectionRecoveryError && (
          <button
            type="button"
            onClick={handleFork}
            disabled={forking}
            title="Fork this conversation into a separate chat thread."
            aria-label="Fork this conversation into a separate chat thread"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-70"
          >
            {forking ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconGitFork size={13} />
            )}
            {forking ? "Forking..." : "Fork chat"}
          </button>
        )}
        <button
          type="button"
          onClick={copyDetails}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-background/80 hover:text-foreground"
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? "Copied" : copyLabel}
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
        ? `${settings.orgName} org`
        : "org"
      : "your account";

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
        throw new Error(body?.error ?? `Save failed (${res.status})`);
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
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [numericValue, settings?.canUpdate]);

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
            Step limit reached
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The agent used{" "}
            {currentLimit
              ? `${currentLimit.toLocaleString()} steps`
              : "all available steps"}
            . Keep going in a fresh turn, or raise the {scopeLabel} limit first.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[116px] flex-1 space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Max steps
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
            "Save"
          )}
        </button>
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconSettings size={12} />
          Settings
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {hasPendingChange ? "Save and keep going" : "Keep going"}
          <IconArrowRight size={12} />
        </button>
      </div>

      {settings && !settings.canUpdate && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Only organization owners and admins can change this limit.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ─── PlanModeCallout ──────────────────────────────────────────────────────────

export function PlanModeCallout({
  canImplementPlan,
  onImplementPlan,
  onSwitchToAct,
}: {
  canImplementPlan: boolean;
  onImplementPlan: () => void;
  onSwitchToAct: () => void;
}) {
  return (
    <div className="shrink-0 px-3 pt-2">
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300">
            <IconClipboardList size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {canImplementPlan ? "Plan ready" : "Plan mode is on"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {canImplementPlan
                ? "Switch to Act and run the proposed plan."
                : "The next turn will stay read-only until you switch to Act."}
            </p>
          </div>
          {canImplementPlan ? (
            <button
              type="button"
              onClick={onImplementPlan}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
            >
              <IconPlayerPlay size={13} />
              Implement Plan
            </button>
          ) : (
            <button
              type="button"
              onClick={onSwitchToAct}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              Act
              <IconArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
