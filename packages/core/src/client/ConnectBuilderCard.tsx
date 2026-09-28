import {
  IconCheck,
  IconCode,
  IconCopy,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { withBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
import { agentNativePath } from "./api-path.js";
import { BuilderBMark } from "./builder-mark.js";
import { writeClipboardText } from "./clipboard.js";
import { requestDesktopLocalCodeChange } from "./desktop-local-code-change.js";
import { getCallbackOrigin } from "./frame.js";
import { useT } from "./i18n.js";
import { DeferredBuilderConnectPopover } from "./settings/deferred-builder-connect-popover.js";
import { useBuilderConnectFlow } from "./settings/useBuilderStatus.js";
import { cn } from "./utils.js";

const DESKTOP_DOWNLOAD_URL = "https://www.agent-native.com/download";
const CODE_CHANGE_FALLBACK_DETAIL =
  "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.";

function isLocalDevelopment() {
  if (typeof window === "undefined") {
    return false;
  }
  const hostname = window.location.hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function hasElectronShellBridge(): boolean {
  if (typeof window === "undefined") return false;
  const electronApi = (
    window as Window & {
      electronAPI?: { appConfig?: unknown };
    }
  ).electronAPI;
  return Boolean(electronApi?.appConfig);
}

export interface ConnectBuilderCardProps {
  configured: boolean;
  builderEnabled?: boolean;
  connectUrl: string;
  orgName?: string | null;
  prompt?: string;
  context?: string;
}

interface BuilderRunResult {
  branchName: string;
  projectId: string;
  url: string;
  status: string;
}

export function ConnectBuilderCard({
  configured: initialConfigured,
  builderEnabled: initialBuilderEnabled = true,
  connectUrl: initialConnectUrl,
  orgName: initialOrgName,
  prompt = "",
  context = "",
}: ConnectBuilderCardProps) {
  const t = useT();
  const flow = useBuilderConnectFlow({
    popupUrl: initialConnectUrl,
    provisionAccount: true,
    trackingSource: "connect_builder_card",
  });
  const configured = flow.statusResolved ? flow.configured : initialConfigured;
  const codeChangeConfigured = flow.statusResolved
    ? flow.codeChangeConfigured
    : initialConfigured;
  const builderEnabled = flow.statusResolved
    ? flow.builderEnabled
    : initialBuilderEnabled;
  const orgName = flow.statusResolved ? flow.orgName : (initialOrgName ?? null);
  const connecting = flow.connecting;

  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [waitlistErr, setWaitlistErr] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [runResult, setRunResult] = useState<BuilderRunResult | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [localCodeChangeRequested, setLocalCodeChangeRequested] =
    useState(false);
  const [localDevelopment] = useState(() => isLocalDevelopment());
  const [electronShell] = useState(() => hasElectronShellBridge());
  const mountedRef = useRef(true);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnectingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (!prompt.trim()) return;
    setSending(true);
    setSendErr(null);
    try {
      const origin = getCallbackOrigin() || window.location.origin;
      const res = await fetch(
        new URL(agentNativePath("/_agent-native/builder/run"), origin).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            ...(context.trim() ? { context } : {}),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${res.status})`,
        );
      }
      if (!mountedRef.current) return;
      setRunResult(data as BuilderRunResult);
      setSending(false);
    } catch (e) {
      if (!mountedRef.current) return;
      setSendErr(e instanceof Error ? e.message : "Send failed");
      setSending(false);
    }
  }, [context, prompt]);

  const handleJoinWaitlist = useCallback(async () => {
    setJoiningWaitlist(true);
    setWaitlistErr(null);
    try {
      const origin = getCallbackOrigin() || window.location.origin;
      const res = await fetch(
        new URL(
          agentNativePath("/_agent-native/builder/branch-waitlist"),
          origin,
        ).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            orgName,
            pageUrl: window.location.href,
            source: "connect_builder_card",
            useCase: "builder_agent_background_coding",
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${res.status})`,
        );
      }
      if (!mountedRef.current) return;
      setWaitlistJoined(true);
      setJoiningWaitlist(false);
    } catch (e) {
      if (!mountedRef.current) return;
      setWaitlistErr(e instanceof Error ? e.message : "Couldn't join waitlist");
      setJoiningWaitlist(false);
    }
  }, [orgName, prompt]);

  const handleCopyPrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    setCopyErr(null);
    const copied = await writeClipboardText(prompt);
    if (!mountedRef.current) return;
    if (!copied) {
      setCopyErr("Couldn't copy the prompt");
      return;
    }
    setPromptCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      if (mountedRef.current) setPromptCopied(false);
    }, 1600);
  }, [prompt]);

  const err = sendErr ?? waitlistErr ?? copyErr ?? flow.error;

  const hasPrompt = prompt.trim().length > 0;
  const canSend = codeChangeConfigured && builderEnabled && hasPrompt;
  const showDesktopLocalHandoff = electronShell && hasPrompt;

  const handleDoLocally = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (requestDesktopLocalCodeChange(prompt, event.currentTarget)) {
        setLocalCodeChangeRequested(true);
      }
    },
    [prompt],
  );

  const openBackgroundAgentSettings = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "background" },
      }),
    );
  }, []);

  useEffect(() => {
    if (flow.connecting) {
      wasConnectingRef.current = true;
      return;
    }
    if (!wasConnectingRef.current) return;
    if (canSend && !sending && !runResult && !sendErr) {
      wasConnectingRef.current = false;
      void handleSend();
    }
  }, [flow.connecting, canSend, sending, runResult, sendErr, handleSend]);
  const showExternalAgentHandoff =
    localDevelopment && !builderEnabled && hasPrompt;
  const showWaitlist = !localDevelopment && !builderEnabled && hasPrompt;

  const connectedCapabilityText =
    builderEnabled && codeChangeConfigured
      ? t("onboarding.builderReadyWithCodeChanges")
      : t("onboarding.builderReadyCreditsOnly");
  const connectedCapabilityAction =
    configured && !(builderEnabled && codeChangeConfigured) ? (
      <button
        type="button"
        onClick={openBackgroundAgentSettings}
        className="ml-1 inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      >
        {t("onboarding.openBackgroundAgentSettings")}
        <IconExternalLink className="h-3 w-3" />
      </button>
    ) : null;
  let title: string;
  let subtitle: React.ReactNode;
  if (localCodeChangeRequested) {
    title = "Preparing a local copy";
    subtitle = "Desktop is cloning this app and applying this request.";
  } else if (runResult) {
    title = "Builder is working on it";
    subtitle = (
      <>
        Working on branch{" "}
        <span className="font-mono text-foreground">
          {runResult.branchName}
        </span>
        . Click through to watch progress in the Visual Editor.
      </>
    );
  } else if (showExternalAgentHandoff) {
    title = "This requires a code change";
    subtitle = showDesktopLocalHandoff
      ? "Make the change in a local copy of this app, or copy the request to another coding agent."
      : "Open your coding agent in this project, then paste this request.";
  } else if (showWaitlist) {
    title = "This requires a code change";
    subtitle = waitlistJoined ? (
      <>
        You're on the waitlist. {CODE_CHANGE_FALLBACK_DETAIL} You can still
        clone the project locally and use the desktop app for code changes.
      </>
    ) : (
      <>
        {CODE_CHANGE_FALLBACK_DETAIL} You can still clone the project locally
        and use the desktop app for code changes.
      </>
    );
  } else if (canSend) {
    title = "Send this to Builder";
    subtitle = (
      <>
        Builder's cloud coding agent will make this code change on a fresh
        branch.
      </>
    );
  } else if (configured) {
    title = "Builder.io connected";
    subtitle = flow.envManaged ? (
      <>
        Managed by this deployment — every user of this app uses the same
        Builder identity. {connectedCapabilityText} {connectedCapabilityAction}
      </>
    ) : orgName ? (
      <>
        Connected to{" "}
        <span className="font-medium text-foreground">{orgName}</span>.{" "}
        {connectedCapabilityText} {connectedCapabilityAction}
      </>
    ) : (
      <>
        {connectedCapabilityText} {connectedCapabilityAction}
      </>
    );
  } else {
    title = "Connect Builder.io";
    subtitle = <>Builder.io's free tier includes AI credits.</>;
  }

  return (
    <div className={cn("my-2 rounded-lg border border-border overflow-hidden")}>
      <div className="flex items-start gap-3 px-4 py-3.5 bg-gradient-to-br from-teal-500/5 via-transparent to-transparent">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            "bg-foreground text-background",
          )}
        >
          {runResult ? (
            <IconLoader2 className="h-5 w-5 animate-spin" />
          ) : showExternalAgentHandoff ? (
            <IconCode className="h-5 w-5" />
          ) : (
            <BuilderBMark className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {subtitle}
          </div>

          {showWaitlist && !showDesktopLocalHandoff && (
            <a
              href={DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground no-underline hover:text-foreground"
            >
              Download desktop app
              <IconExternalLink className="h-3 w-3" />
            </a>
          )}

          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}

          <div className="mt-3">
            {runResult ? (
              <a
                href={withBuilderUtmTrackingParams(runResult.url, {
                  campaign: "product",
                  content: "connect_builder_card_branch",
                })}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                )}
              >
                Open branch in Builder
                <IconExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : canSend ? (
              <div className="flex flex-wrap gap-2">
                {showDesktopLocalHandoff && (
                  <button
                    type="button"
                    data-desktop-local-code-change
                    onClick={handleDoLocally}
                    disabled={localCodeChangeRequested}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
                      localCodeChangeRequested && "cursor-wait opacity-70",
                    )}
                  >
                    {localCodeChangeRequested ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconCode className="h-3.5 w-3.5" />
                    )}
                    {localCodeChangeRequested
                      ? "Preparing locally…"
                      : "Do locally"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    "bg-foreground text-background hover:bg-foreground/90",
                    sending && "opacity-70 cursor-wait",
                  )}
                >
                  {sending ? (
                    <>
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      Sending to Builder…
                    </>
                  ) : (
                    <>Send to Builder</>
                  )}
                </button>
              </div>
            ) : showExternalAgentHandoff ? (
              <div className="flex flex-wrap gap-2">
                {showDesktopLocalHandoff && (
                  <button
                    type="button"
                    data-desktop-local-code-change
                    onClick={handleDoLocally}
                    disabled={localCodeChangeRequested}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "bg-foreground text-background hover:bg-foreground/90",
                      localCodeChangeRequested && "cursor-wait opacity-70",
                    )}
                  >
                    {localCodeChangeRequested ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconCode className="h-3.5 w-3.5" />
                    )}
                    {localCodeChangeRequested
                      ? "Preparing locally…"
                      : "Do locally"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCopyPrompt()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
                  )}
                >
                  {promptCopied ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5" />
                      Prompt copied
                    </>
                  ) : (
                    <>
                      <IconCopy className="h-3.5 w-3.5" />
                      Copy prompt
                    </>
                  )}
                </button>
              </div>
            ) : showWaitlist && !waitlistJoined ? (
              <div className="flex flex-wrap gap-2">
                {showDesktopLocalHandoff && (
                  <button
                    type="button"
                    data-desktop-local-code-change
                    onClick={handleDoLocally}
                    disabled={localCodeChangeRequested}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "bg-foreground text-background hover:bg-foreground/90",
                      localCodeChangeRequested && "cursor-wait opacity-70",
                    )}
                  >
                    {localCodeChangeRequested ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconCode className="h-3.5 w-3.5" />
                    )}
                    {localCodeChangeRequested
                      ? "Preparing locally…"
                      : "Do locally"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleJoinWaitlist}
                  disabled={joiningWaitlist}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
                    joiningWaitlist && "opacity-70 cursor-wait",
                  )}
                >
                  {joiningWaitlist ? (
                    <>
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      Joining…
                    </>
                  ) : (
                    <>Join the waitlist</>
                  )}
                </button>
              </div>
            ) : !configured ? (
              <div className="flex flex-wrap gap-2">
                {showDesktopLocalHandoff && (
                  <button
                    type="button"
                    data-desktop-local-code-change
                    onClick={handleDoLocally}
                    disabled={localCodeChangeRequested}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "bg-foreground text-background hover:bg-foreground/90",
                      localCodeChangeRequested && "cursor-wait opacity-70",
                    )}
                  >
                    {localCodeChangeRequested ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconCode className="h-3.5 w-3.5" />
                    )}
                    {localCodeChangeRequested
                      ? "Preparing locally…"
                      : "Do locally"}
                  </button>
                )}
                <DeferredBuilderConnectPopover flow={flow}>
                  <button
                    type="button"
                    disabled={connecting}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
                      connecting && "opacity-70 cursor-wait",
                    )}
                  >
                    {connecting ? (
                      <>
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                        Waiting for Builder…
                      </>
                    ) : (
                      "Connect Builder"
                    )}
                  </button>
                </DeferredBuilderConnectPopover>
              </div>
            ) : showDesktopLocalHandoff ? (
              <button
                type="button"
                data-desktop-local-code-change
                onClick={handleDoLocally}
                disabled={localCodeChangeRequested}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
                  localCodeChangeRequested && "cursor-wait opacity-70",
                )}
              >
                {localCodeChangeRequested ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconCode className="h-3.5 w-3.5" />
                )}
                {localCodeChangeRequested ? "Preparing locally…" : "Do locally"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
