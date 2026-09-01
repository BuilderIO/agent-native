import {
  AgentTerminal,
  type AgentTerminalSubmitRequest,
} from "@agent-native/core/terminal";
import { IconLoader2, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useState, type CSSProperties } from "react";

import type { DesktopTerminalContext } from "../../../shared/ipc-channels.js";
import {
  DESKTOP_TERMINAL_AGENT_OPTIONS,
  type DesktopTerminalAgentId,
} from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";

interface DesktopTerminalTabsProps {
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
  activeApp?: {
    id: string;
    name: string;
    path?: string;
    view?: string;
  };
  submitRequest?: AgentTerminalSubmitRequest;
  onPromptSubmitted?: (request: AgentTerminalSubmitRequest) => void;
}

type TerminalConnection =
  | { state: "loading" }
  | { state: "ready"; wsUrl: string }
  | { state: "error"; message: string };

interface TerminalInfo {
  available?: boolean;
  wsPort?: number;
  wsUrl?: string;
  error?: string;
}

function readChatSurface(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector<HTMLElement>(
      ".code-agents-overview--chat-surface",
    ) ??
    document.querySelector<HTMLElement>(".agent-sidebar-panel") ??
    document.querySelector<HTMLElement>(".agent-sidebar-shell") ??
    document.querySelector<HTMLElement>(".code-agents-rail") ??
    document.querySelector<HTMLElement>(".code-agents-surface")
  );
}

function readChatSurfaceBackground(): string {
  const surface = readChatSurface();
  if (surface) {
    const background = getComputedStyle(surface).backgroundColor.trim();
    if (background) return background;
  }
  if (typeof document === "undefined") return "var(--sidebar-bg)";
  const host =
    document.querySelector<HTMLElement>(".desktop-chat-first-hub") ??
    document.body;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.width = "1px";
  probe.style.height = "1px";
  probe.style.backgroundColor =
    "var(--agent-native-lower-surface, hsl(var(--sidebar-background)))";
  host.appendChild(probe);
  const lowerSurface = getComputedStyle(probe).backgroundColor.trim();
  probe.remove();
  if (lowerSurface) return lowerSurface;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-bg")
      .trim() || "var(--sidebar-bg)"
  );
}

function readSidebarForeground(): string {
  const surface = readChatSurface();
  if (surface) {
    const foreground = getComputedStyle(surface).color.trim();
    if (foreground) return foreground;
  }
  if (typeof document === "undefined") return "var(--shell-fg)";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--shell-fg")
      .trim() || "var(--shell-fg)"
  );
}

function terminalInfoFrom(value: unknown): TerminalInfo {
  if (!value || typeof value !== "object") {
    return {
      available: false,
      error: "The local terminal returned an invalid response.",
    };
  }
  const info = value as Record<string, unknown>;
  return {
    available: info.available === true,
    wsPort: typeof info.wsPort === "number" ? info.wsPort : undefined,
    wsUrl: typeof info.wsUrl === "string" ? info.wsUrl : undefined,
    error: typeof info.error === "string" ? info.error : undefined,
  };
}

export default function DesktopTerminalTabs({
  agent,
  theme,
  className,
  activeApp,
  submitRequest,
  onPromptSubmitted,
}: DesktopTerminalTabsProps) {
  const [connection, setConnection] = useState<TerminalConnection>({
    state: "loading",
  });
  const [terminalBackground, setTerminalBackground] = useState(
    readChatSurfaceBackground,
  );
  const [terminalForeground, setTerminalForeground] = useState(
    readSidebarForeground,
  );
  const selectedAgent =
    DESKTOP_TERMINAL_AGENT_OPTIONS.find((option) => option.id === agent) ??
    DESKTOP_TERMINAL_AGENT_OPTIONS[0];

  useEffect(() => {
    const syncBackground = () =>
      setTerminalBackground(readChatSurfaceBackground());
    const syncForeground = () => setTerminalForeground(readSidebarForeground());
    syncBackground();
    syncForeground();
    const frame = window.requestAnimationFrame(syncBackground);
    const foregroundFrame = window.requestAnimationFrame(syncForeground);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(foregroundFrame);
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const context: DesktopTerminalContext | null = activeApp
      ? {
          appId: activeApp.id,
          ...(activeApp.path ? { path: activeApp.path } : {}),
          ...(activeApp.view ? { view: activeApp.view } : {}),
        }
      : null;
    const getTerminalInfoUrl = window.electronAPI?.desktopChat
      ? (value: DesktopTerminalContext | null) =>
          window.electronAPI!.desktopChat!.getTerminalInfoUrl(value)
      : undefined;
    if (!getTerminalInfoUrl) {
      setConnection({
        state: "error",
        message: "Terminal tabs are unavailable in this desktop build.",
      });
      return () => {
        cancelled = true;
      };
    }

    setConnection({ state: "loading" });
    void getTerminalInfoUrl(context)
      .then(async (infoUrl) => {
        if (cancelled) return;
        if (!infoUrl) {
          throw new Error("The desktop terminal has no connection.");
        }
        const response = await fetch(infoUrl);
        const body = await response.text();
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          throw new Error(
            response.ok
              ? "The desktop terminal returned an invalid response."
              : `The desktop terminal failed to start (${response.status}).`,
          );
        }
        const info = terminalInfoFrom(payload);
        const wsUrl =
          info.wsUrl ??
          (info.wsPort ? `ws://127.0.0.1:${info.wsPort}/ws` : undefined);
        if (!response.ok || !info.available || !wsUrl) {
          throw new Error(info.error ?? "The desktop terminal is not running.");
        }
        setConnection({
          state: "ready",
          wsUrl,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConnection({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "The desktop terminal could not be reached.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeApp?.id, activeApp?.path, activeApp?.view]);

  const workbenchStyle = {
    "--desktop-terminal-background": terminalBackground,
  } as CSSProperties;

  return (
    <section
      className={["desktop-terminal-tabs", className].filter(Boolean).join(" ")}
      style={workbenchStyle}
      data-desktop-terminal-tabs
      data-terminal-background={terminalBackground}
    >
      <div className="desktop-terminal-tabs__body">
        {connection.state === "loading" ? (
          <div className="desktop-terminal-tabs__state" role="status">
            <IconLoader2
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
            <span>Connecting to the local terminal…</span>
          </div>
        ) : connection.state === "error" ? (
          <div className="desktop-terminal-tabs__state" role="status">
            <IconTerminal2 size={18} aria-hidden="true" />
            <span>{connection.message}</span>
          </div>
        ) : (
          <AgentTerminal
            key={`${activeApp?.id ?? "chat"}:${activeApp?.path ?? ""}:${activeApp?.view ?? ""}`}
            command={selectedAgent.command}
            wsUrl={connection.wsUrl}
            hideInFrame={false}
            className="desktop-terminal-tabs__terminal"
            submitRequest={submitRequest}
            onPromptSubmitted={onPromptSubmitted}
            theme={{
              background: terminalBackground,
              cursor: terminalForeground,
              foreground: terminalForeground,
            }}
          />
        )}
      </div>
    </section>
  );
}
