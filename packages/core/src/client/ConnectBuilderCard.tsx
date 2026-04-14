import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconSparkles,
} from "@tabler/icons-react";
import { getCallbackOrigin } from "./frame.js";
import { cn } from "./utils.js";

export interface ConnectBuilderCardProps {
  configured: boolean;
  connectUrl: string;
  orgName?: string | null;
}

/**
 * Rich inline card rendered for the `connect-builder` tool call. Shows a
 * prominent Connect button that opens the Builder CLI auth flow and polls
 * /_agent-native/builder/status until credentials land.
 */
export function ConnectBuilderCard({
  configured: initialConfigured,
  connectUrl: initialConnectUrl,
  orgName: initialOrgName,
}: ConnectBuilderCardProps) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [orgName, setOrgName] = useState<string | null>(initialOrgName ?? null);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

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
    // Clear any in-flight poll from a previous click so intervals can't stack.
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setConnecting(true);
    setErr(null);
    try {
      const origin = getCallbackOrigin() || window.location.origin;
      // Re-fetch in case the cached URL is stale (different origin, new tab).
      let connectUrl = initialConnectUrl;
      try {
        const res = await fetch(`${origin}/_agent-native/builder/status`);
        if (res.ok) {
          const s = (await res.json()) as { connectUrl?: string };
          if (s.connectUrl) connectUrl = s.connectUrl;
        }
      } catch {
        // fall back to the URL baked into the tool result
      }

      const popup = window.open(connectUrl, "_blank", "noopener,noreferrer");
      if (!popup) throw new Error("Popup blocked — allow popups and retry.");

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

  return (
    <div
      className={cn(
        "my-2 rounded-lg border overflow-hidden",
        configured ? "border-emerald-500/30" : "border-border",
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5 bg-gradient-to-br from-teal-500/5 via-transparent to-transparent">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            configured
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-teal-500/10 text-teal-500",
          )}
        >
          {configured ? (
            <IconCheck className="h-5 w-5" />
          ) : (
            <IconSparkles className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {configured ? "Builder.io connected" : "Connect Builder.io"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {configured ? (
              <>
                {orgName ? (
                  <>
                    Connected to{" "}
                    <span className="font-medium text-foreground">
                      {orgName}
                    </span>
                    . LLM access, browser automation, and more are ready to use.
                  </>
                ) : (
                  <>
                    LLM access, browser automation, and more are ready to use.
                  </>
                )}
              </>
            ) : (
              <>
                Unlocks AI, browser automation, and hosted deploys.{" "}
                <span className="inline-flex items-center rounded-sm bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-600">
                  Free during beta
                </span>
              </>
            )}
          </div>
          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          {!configured && (
            <div className="mt-3">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
