import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { getCallbackOrigin } from "./frame.js";
import { useBuilderConnectFlow } from "./settings/useBuilderStatus.js";
import { BuilderBMark } from "./builder-mark.js";
import { cn } from "./utils.js";
import { agentNativePath } from "./api-path.js";

export interface ConnectBuilderCardProps {
  configured: boolean;
  /**
   * True when ENABLE_BUILDER / BUILDER_BRANCH_PROJECT_ID is set on the
   * deploy. When false, the card shows a "coming soon" waitlist CTA instead
   * of a Send button — the /builder/run endpoint would 403 anyway.
   */
  builderEnabled?: boolean;
  connectUrl: string;
  orgName?: string | null;
  /** The user's feature/change request, forwarded to Builder's cloud agent
   *  when they click Send. Empty for generic "connect Builder" prompts. */
  prompt?: string;
}

interface BuilderRunResult {
  branchName: string;
  projectId: string;
  url: string;
  status: string;
}

/**
 * Rich inline card rendered for the `connect-builder` tool call. Shows a
 * prominent Connect button that opens the Builder CLI auth flow and polls
 * /_agent-native/builder/status until credentials land.
 */
export function ConnectBuilderCard({
  configured: initialConfigured,
  builderEnabled: initialBuilderEnabled = true,
  connectUrl: initialConnectUrl,
  orgName: initialOrgName,
  prompt = "",
}: ConnectBuilderCardProps) {
  // The connect-poll state machine is shared — the tool-call result is
  // frozen at render time, so the hook's mount-time fetch + focus refresh
  // is what catches a flow the user completed in another tab.
  const flow = useBuilderConnectFlow({ popupUrl: initialConnectUrl });
  // Only use the server-rendered props until the hook's first status
  // fetch returns. After that, the hook is authoritative — including for
  // the disconnect case (where `flow.configured` flips back to `false`
  // even though `initialConfigured` was `true` at render time).
  const configured = flow.hasFetchedStatus
    ? flow.configured
    : initialConfigured;
  const builderEnabled = flow.hasFetchedStatus
    ? flow.builderEnabled
    : initialBuilderEnabled;
  const orgName = flow.hasFetchedStatus
    ? flow.orgName
    : (initialOrgName ?? null);
  const connecting = flow.connecting;

  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [waitlistErr, setWaitlistErr] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [runResult, setRunResult] = useState<BuilderRunResult | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
          body: JSON.stringify({ prompt }),
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
  }, [prompt]);

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
        { method: "POST" },
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
  }, []);

  // Combine connect-flow errors, send errors, and waitlist errors.
  const err = sendErr ?? waitlistErr ?? flow.error;

  const hasPrompt = prompt.trim().length > 0;
  const canSend = configured && builderEnabled && hasPrompt;
  // Branch creation is gated by deploy env (ENABLE_BUILDER / project id).
  // Show waitlist when the user has connected and has a prompt, but the
  // deploy hasn't been opted in yet.
  const showWaitlist = configured && !builderEnabled && hasPrompt;

  // Title + subtitle depend on which mode we're in. We compute them up front
  // so the render tree below stays flat.
  let title: string;
  let subtitle: React.ReactNode;
  if (runResult) {
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
  } else if (showWaitlist) {
    title = waitlistJoined
      ? "You're on the waitlist"
      : "Builder branches — coming soon";
    subtitle = waitlistJoined ? (
      <>We'll let you know as soon as cloud branch creation is available.</>
    ) : (
      <>
        Cloud branch creation isn't available on this deployment yet. Join the
        waitlist and we'll let you know when it ships.
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
        Builder identity. LLM access, browser automation, and more are ready to
        use.
      </>
    ) : orgName ? (
      <>
        Connected to{" "}
        <span className="font-medium text-foreground">{orgName}</span>. LLM
        access, browser automation, and more are ready to use.
      </>
    ) : (
      <>LLM access, browser automation, and more are ready to use.</>
    );
  } else {
    title = "Connect Builder.io";
    subtitle = (
      <>
        One click to spin up a cloud code sandbox — Builder writes the changes
        for you, no local setup needed.
      </>
    );
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

          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}

          <div className="mt-3">
            {runResult ? (
              <a
                href={runResult.url}
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
            ) : showWaitlist && !waitlistJoined ? (
              <button
                type="button"
                onClick={handleJoinWaitlist}
                disabled={joiningWaitlist}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
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
            ) : !configured ? (
              <button
                type="button"
                onClick={flow.start}
                disabled={connecting}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                  connecting && "opacity-70 cursor-wait",
                )}
              >
                {connecting ? (
                  <>
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    Waiting for Builder…
                  </>
                ) : (
                  <>
                    Connect Builder
                    <IconExternalLink className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
