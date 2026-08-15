import { AgentTerminal } from "@agent-native/core/terminal";
import type { AppConfig } from "@shared/app-registry";
import { IconLoader2, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  DESKTOP_TERMINAL_AGENT_OPTIONS,
  type DesktopTerminalAgentId,
} from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";

interface DesktopTerminalTabsProps {
  apps: readonly AppConfig[];
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
}

type TerminalConnection =
  | { state: "loading" }
  | { state: "ready"; wsUrl: string }
  | { state: "error"; message: string };

interface TerminalInfo {
  available?: boolean;
  wsPort?: number;
  error?: string;
}

function isLocalDevApp(app: AppConfig): boolean {
  return (
    app.enabled !== false &&
    app.mode === "dev" &&
    Boolean(app.devUrl?.trim() || app.devPort || app.localPath)
  );
}

function findTerminalApp(apps: readonly AppConfig[]): AppConfig | undefined {
  return apps.find(isLocalDevApp);
}

function readSidebarSurface(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector<HTMLElement>(".code-agents-rail") ??
    document.querySelector<HTMLElement>(".code-agents-surface")
  );
}

function readSidebarBackground(): string {
  const surface = readSidebarSurface();
  if (surface) {
    const background = getComputedStyle(surface).backgroundColor.trim();
    if (background) return background;
  }
  if (typeof document === "undefined") return "var(--sidebar-bg)";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-bg")
      .trim() || "var(--sidebar-bg)"
  );
}

function readSidebarForeground(): string {
  const surface = readSidebarSurface();
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
    error: typeof info.error === "string" ? info.error : undefined,
  };
}

export default function DesktopTerminalTabs({
  apps,
  agent,
  theme,
  className,
}: DesktopTerminalTabsProps) {
  const [connection, setConnection] = useState<TerminalConnection>({
    state: "loading",
  });
  const [terminalBackground, setTerminalBackground] = useState(
    readSidebarBackground,
  );
  const [terminalForeground, setTerminalForeground] = useState(
    readSidebarForeground,
  );
  const terminalApp = useMemo(() => findTerminalApp(apps), [apps]);
  const selectedAgent =
    DESKTOP_TERMINAL_AGENT_OPTIONS.find((option) => option.id === agent) ??
    DESKTOP_TERMINAL_AGENT_OPTIONS[0];

  useEffect(() => {
    const syncBackground = () => setTerminalBackground(readSidebarBackground());
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
    const getTerminalInfoUrl =
      window.electronAPI?.desktopChat?.getTerminalInfoUrl;
    if (!terminalApp || !getTerminalInfoUrl) {
      setConnection({
        state: "error",
        message: terminalApp
          ? "Terminal tabs are unavailable in this desktop build."
          : "Set an app to Local in Settings to start terminal tabs.",
      });
      return () => {
        cancelled = true;
      };
    }

    setConnection({ state: "loading" });
    void getTerminalInfoUrl(terminalApp.id)
      .then(async (infoUrl) => {
        if (cancelled) return;
        if (!infoUrl) {
          throw new Error("The local app has no terminal connection.");
        }
        const response = await fetch(infoUrl);
        const info = terminalInfoFrom(await response.json());
        if (!response.ok || !info.available || !info.wsPort) {
          throw new Error(
            info.error ?? "The local app terminal is not running.",
          );
        }
        setConnection({
          state: "ready",
          wsUrl: `ws://127.0.0.1:${info.wsPort}/ws`,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConnection({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "The local app terminal could not be reached.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [terminalApp]);

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
            command={selectedAgent.command}
            wsUrl={connection.wsUrl}
            hideInFrame={false}
            className="desktop-terminal-tabs__terminal"
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
