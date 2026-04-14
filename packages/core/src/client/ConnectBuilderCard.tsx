import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { getCallbackOrigin } from "./frame.js";
import { cn } from "./utils.js";

export interface ConnectBuilderCardProps {
  configured: boolean;
  /** Whether ENABLE_BUILDER is set on the server. When false, connect is gated
   *  behind a waitlist — show "Coming soon" + Join-the-waitlist CTA instead of
   *  the one-click connect flow. */
  builderEnabled: boolean;
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

const WAITLIST_URL = "https://www.builder.io/c/waitlist";

/**
 * Builder.io monogram. Simple B letterform on a dark rounded tile.
 */
function BuilderBMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M6.5 4.5h6.75a4.25 4.25 0 0 1 2.56 7.64 4.5 4.5 0 0 1-2.31 8.36H6.5V4.5Zm3 3v3.75h3.75a1.875 1.875 0 1 0 0-3.75H9.5Zm0 6.5v3.5h4a1.75 1.75 0 1 0 0-3.5h-4Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Rich inline card rendered for the `connect-builder` tool call. Shows a
 * prominent Connect button that opens the Builder CLI auth flow and polls
 * /_agent-native/builder/status until credentials land.
 *
 * When ENABLE_BUILDER isn't set, swaps to a "Coming soon" waitlist CTA.
 */
export function ConnectBuilderCard({
  configured: initialConfigured,
  builderEnabled,
  connectUrl: initialConnectUrl,
  orgName: initialOrgName,
  prompt = "",
}: ConnectBuilderCardProps) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [orgName, setOrgName] = useState<string | null>(initialOrgName ?? null);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [runResult, setRunResult] = useState<BuilderRunResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const handleSend = useCallback(async () => {
    if (!prompt.trim()) return;
    setSending(true);
    setErr(null);
    try {
      const origin = getCallbackOrigin() || window.location.origin;
      const res = await fetch(`${origin}/_agent-native/builder/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
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
      setErr(e instanceof Error ? e.message : "Send failed");
      setSending(false);
    }
  }, [prompt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setConnecting(true);
    setErr(null);
    // Open the popup SYNCHRONOUSLY inside the click handler. Any await
    // before window.open() lets the user-gesture token expire, which
    // causes popup blockers to block entirely or fall back to same-tab
    // navigation. The URL was generated server-side with the correct
    // callback origin, so no re-fetch is needed.
    try {
      const popup = window.open(
        initialConnectUrl,
        "_blank",
        "noopener,noreferrer",
      );
      // Some browsers return null with noopener — treat as "opened" since
      // the navigation still happens. Only treat explicit popup-blocker
      // errors as failures.
      if (popup === null && !initialConnectUrl) {
        throw new Error("Popup blocked — allow popups and retry.");
      }
      const origin = getCallbackOrigin() || window.location.origin;

      const start = Date.now();
      const timeoutMs = 5 * 60 * 1000;
      const stop = () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${origin}/_agent-native/builder/status`);
          if (!r.ok) return;
          const s = (await r.json()) as {
            configured: boolean;
            orgName?: string | null;
          };
          if (!mountedRef.current) {
            stop();
            return;
          }
          if (s.configured) {
            stop();
            setConfigured(true);
            setOrgName(s.orgName ?? null);
            setConnecting(false);
          } else if (Date.now() - start > timeoutMs) {
            stop();
            setConnecting(false);
            setErr("Timed out — try again.");
          }
        } catch {
          // transient poll error — keep going
        }
      }, 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Connect failed");
      setConnecting(false);
    }
  }, [initialConnectUrl]);

  const showWaitlist = !configured && !builderEnabled;
  const canSend = configured && builderEnabled && prompt.trim().length > 0;

  // Title + subtitle depend on which mode we're in. We compute them up front
  // so the render tree below stays flat.
  let title: string;
  let subtitle: React.ReactNode;
  if (runResult) {
    title = "Sent to Builder";
    subtitle = (
      <>
        Working on branch{" "}
        <span className="font-mono text-foreground">
          {runResult.branchName}
        </span>
        . Click through to watch progress in the Visual Editor.
      </>
    );
  } else if (canSend) {
    title = "Send this to Builder";
    subtitle = (
      <>
        Builder's cloud agent will code this change on a fresh branch — click
        through when it's ready.
      </>
    );
  } else if (configured) {
    title = "Builder.io connected";
    subtitle = orgName ? (
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
            <IconCheck className="h-5 w-5" />
          ) : (
            <BuilderBMark className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            {showWaitlist && (
              <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Coming soon
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {subtitle}
          </div>

          {canSend && prompt && !runResult && (
            <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground line-clamp-3 break-words">
              {prompt}
            </div>
          )}

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
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
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
                  <>
                    Send to Builder
                    <IconExternalLink className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            ) : showWaitlist ? (
              <a
                href={WAITLIST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                )}
              >
                Join the waitlist
                <IconExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : !configured ? (
              <button
                type="button"
                onClick={handleConnect}
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
