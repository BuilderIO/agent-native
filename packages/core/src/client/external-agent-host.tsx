import { Button } from "@agent-native/toolkit/ui/button";
import { IconMessageCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { getFrameOrigin } from "./frame.js";
import { useT } from "./i18n.js";
import {
  getMcpAppHostContext,
  initializeMcpAppHost,
  useMcpAppHostContext,
} from "./mcp-app-host.js";
import { cn } from "./utils.js";

export type ExternalAgentHostId = "claude" | "chatgpt" | "codex";

export interface ExternalAgentHost {
  id: ExternalAgentHostId;
  label: "Claude" | "ChatGPT" | "Codex";
}

export interface ExternalAgentHostSignals {
  hostname?: string | null;
  frameOrigin?: string | null;
  referrer?: string | null;
  openAiBridge?: unknown;
  hostInfo?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hostnameFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.trim().replace(/\.$/, "").toLowerCase() || null;
  }
}

function isHostOrSubdomain(hostname: string | null, host: string): boolean {
  return hostname === host || hostname?.endsWith(`.${host}`) === true;
}

function hostFromName(value: unknown): ExternalAgentHost | null {
  if (typeof value !== "string") return null;
  const name = value.toLowerCase();
  if (name.includes("codex")) return { id: "codex", label: "Codex" };
  if (name.includes("chatgpt") || name.includes("openai")) {
    return { id: "chatgpt", label: "ChatGPT" };
  }
  if (
    name.includes("claude") ||
    name.includes("anthropic") ||
    name.includes("cowork")
  ) {
    return { id: "claude", label: "Claude" };
  }
  return null;
}

export function detectExternalAgentHost(
  signals: ExternalAgentHostSignals,
): ExternalAgentHost | null {
  if (isRecord(signals.openAiBridge)) {
    return { id: "chatgpt", label: "ChatGPT" };
  }

  const hostnames = [
    signals.hostname,
    signals.frameOrigin,
    signals.referrer,
  ].map(hostnameFrom);
  if (
    hostnames.some((hostname) =>
      isHostOrSubdomain(hostname, "claudemcpcontent.com"),
    )
  ) {
    return { id: "claude", label: "Claude" };
  }
  if (
    hostnames.some((hostname) =>
      isHostOrSubdomain(hostname, "web-sandbox.oaiusercontent.com"),
    )
  ) {
    return { id: "chatgpt", label: "ChatGPT" };
  }

  const hostInfo = isRecord(signals.hostInfo) ? signals.hostInfo : null;
  return hostFromName(hostInfo?.name);
}

function readExternalAgentHost(hostInfo: unknown): ExternalAgentHost | null {
  if (typeof window === "undefined") return null;
  return detectExternalAgentHost({
    hostname: window.location.hostname,
    frameOrigin: getFrameOrigin(),
    referrer: document.referrer,
    openAiBridge: (window as unknown as { openai?: unknown }).openai,
    hostInfo,
  });
}

export function getExternalAgentHost(): ExternalAgentHost | null {
  return readExternalAgentHost(getMcpAppHostContext().hostInfo);
}

export function useExternalAgentHost(): ExternalAgentHost | null {
  const mcpHost = useMcpAppHostContext();
  const [host, setHost] = useState<ExternalAgentHost | null>(() =>
    readExternalAgentHost(mcpHost.hostInfo),
  );

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) return;
      const nextHost = readExternalAgentHost(mcpHost.hostInfo);
      setHost((currentHost) =>
        currentHost?.id === nextHost?.id ? currentHost : nextHost,
      );
    };
    window.addEventListener("message", refresh);
    window.addEventListener("openai:set_globals", refresh);
    refresh();
    void initializeMcpAppHost().then(() => {
      if (!active) return;
      const nextHost = readExternalAgentHost(getMcpAppHostContext().hostInfo);
      setHost((currentHost) =>
        currentHost?.id === nextHost?.id ? currentHost : nextHost,
      );
    });
    return () => {
      active = false;
      window.removeEventListener("message", refresh);
      window.removeEventListener("openai:set_globals", refresh);
    };
  }, [mcpHost.hostInfo]);

  return host;
}

type ExternalAgentNudgeVariant = "sidebar" | "prompt";

const DISMISSED_KEY_PREFIX = "agent-native:external-agent-nudge";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

function dismissedKey(
  host: ExternalAgentHost,
  variant: ExternalAgentNudgeVariant,
): string {
  return `${DISMISSED_KEY_PREFIX}:${host.id}:${variant}`;
}

function wasDismissed(
  host: ExternalAgentHost,
  variant: ExternalAgentNudgeVariant,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(dismissedKey(host, variant)) === "1";
  } catch {
    // coercion-ok: storage is optional; a read failure means not dismissed.
    return false;
  }
}

function rememberDismissal(
  host: ExternalAgentHost,
  variant: ExternalAgentNudgeVariant,
): void {
  try {
    window.sessionStorage.setItem(dismissedKey(host, variant), "1");
  } catch {
    // coercion-ok: storage is optional; component state still dismisses now.
  }
}

export function ExternalAgentNudge({
  variant,
  className,
}: {
  variant: ExternalAgentNudgeVariant;
  className?: string;
}) {
  const t = useT();
  const host = useExternalAgentHost();
  const [dismissed, setDismissed] = useState(false);
  const nudgeRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const dismissNudge = useCallback(() => {
    if (!host) return;
    rememberDismissal(host, variant);
    setDismissed(true);
  }, [host, variant]);

  const restoreFocus = useCallback(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  }, []);

  useEffect(() => {
    setDismissed(host ? wasDismissed(host, variant) : false);
  }, [host, variant]);

  useEffect(() => {
    if (host && !dismissed) return;
    restoreFocus();
  }, [dismissed, host, restoreFocus]);

  useEffect(() => {
    if (!host || dismissed) return;

    const nudge = nudgeRef.current;
    if (!nudge) return;

    if (
      !previouslyFocusedRef.current &&
      document.activeElement instanceof HTMLElement &&
      !nudge.contains(document.activeElement)
    ) {
      previouslyFocusedRef.current = document.activeElement;
    }

    const focusFirst = () => {
      const firstFocusable = getFocusableElements(nudge)[0];
      (firstFocusable ?? nudge).focus();
    };

    focusFirst();

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !nudge.contains(event.target)) {
        focusFirst();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissNudge();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(nudge);
      if (focusable.length === 0) {
        event.preventDefault();
        nudge.focus();
        return;
      }

      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const lastIndex = focusable.length - 1;
      if (
        (event.shiftKey && (activeIndex <= 0 || activeIndex === -1)) ||
        (!event.shiftKey && (activeIndex === lastIndex || activeIndex === -1))
      ) {
        event.preventDefault();
        focusable[event.shiftKey ? lastIndex : 0]?.focus();
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown, true);

    const parent = nudge.parentElement;
    const inertSiblings = parent
      ? Array.from(parent.children).filter(
          (element): element is HTMLElement => element !== nudge,
        )
      : [];
    const previouslyInert = new Map<HTMLElement, boolean>();
    for (const sibling of inertSiblings) {
      const hadInert = sibling.hasAttribute("inert");
      previouslyInert.set(sibling, hadInert);
      if (!hadInert) sibling.setAttribute("inert", "");
    }

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown, true);
      for (const sibling of inertSiblings) {
        if (!previouslyInert.get(sibling)) sibling.removeAttribute("inert");
      }
      if (!nudge.isConnected) restoreFocus();
    };
  }, [dismissed, dismissNudge, host, restoreFocus]);

  useEffect(() => restoreFocus, [restoreFocus]);

  if (!host || dismissed) return null;

  const title = t(
    variant === "sidebar"
      ? "agentChat.agentHostNudge.sidebarTitle"
      : "agentChat.agentHostNudge.promptTitle",
    { agent: host.label },
  );
  const description = t(
    variant === "sidebar"
      ? "agentChat.agentHostNudge.sidebarDescription"
      : "agentChat.agentHostNudge.promptDescription",
    { agent: host.label },
  );
  const dismissLabel = t(
    variant === "sidebar"
      ? "agentChat.agentHostNudge.useThisChat"
      : "agentChat.agentHostNudge.useThisPrompt",
  );

  return (
    <div
      ref={nudgeRef}
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-4 backdrop-blur-[3px]",
        className,
      )}
      data-external-agent-nudge={variant}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className="w-full max-w-[320px] rounded-xl border border-border/80 bg-card/95 p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconMessageCircle className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p id={titleId} className="text-sm font-medium text-foreground">
              {title}
            </p>
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
            >
              {description}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 h-7 px-2 text-xs text-muted-foreground"
              onClick={dismissNudge}
            >
              {dismissLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
