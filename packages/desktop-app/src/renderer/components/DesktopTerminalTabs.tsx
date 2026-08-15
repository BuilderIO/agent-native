import { AgentTerminal } from "@agent-native/core/client/terminal";
import type { AppConfig } from "@shared/app-registry";
import {
  IconLoader2,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

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

interface TerminalTab {
  id: string;
  label: string;
}

let terminalTabCounter = 1;

function createTerminalTab(): TerminalTab {
  const number = terminalTabCounter++;
  return { id: `desktop-terminal-${number}`, label: `Terminal ${number}` };
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

function readSidebarBackground(theme: RendererTheme): string {
  if (typeof document === "undefined") {
    return theme === "dark" ? "hsl(0 0% 10%)" : "hsl(0 0% 97%)";
  }

  const rail = document.querySelector<HTMLElement>(".code-agents-rail");
  const surface =
    rail ?? document.querySelector<HTMLElement>(".code-agents-surface");
  const background = surface
    ? getComputedStyle(surface).backgroundColor
    : getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-bg",
      );
  if (background && background !== "rgba(0, 0, 0, 0)") return background.trim();
  return theme === "dark" ? "hsl(0 0% 10%)" : "hsl(0 0% 97%)";
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
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTerminalTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const [connection, setConnection] = useState<TerminalConnection>({
    state: "loading",
  });
  const [terminalBackground, setTerminalBackground] = useState(() =>
    readSidebarBackground(theme),
  );
  const terminalApp = useMemo(() => findTerminalApp(apps), [apps]);
  const selectedAgent =
    DESKTOP_TERMINAL_AGENT_OPTIONS.find((option) => option.id === agent) ??
    DESKTOP_TERMINAL_AGENT_OPTIONS[0];

  useEffect(() => {
    const syncBackground = () =>
      setTerminalBackground(readSidebarBackground(theme));
    syncBackground();
    const frame = window.requestAnimationFrame(syncBackground);
    return () => window.cancelAnimationFrame(frame);
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

  const addTab = useCallback(() => {
    const next = createTerminalTab();
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length === 1) return current;
        const index = current.findIndex((tab) => tab.id === tabId);
        const next = current.filter((tab) => tab.id !== tabId);
        if (tabId === activeTabId) {
          setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "");
        }
        return next;
      });
    },
    [activeTabId],
  );

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
      <header className="desktop-terminal-tabs__header">
        <div
          className="desktop-terminal-tabs__tab-list"
          role="tablist"
          aria-label="Terminal tabs"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`desktop-terminal-tabs__tab${active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="desktop-terminal-tabs__tab-button"
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <IconTerminal2 size={14} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    className="desktop-terminal-tabs__tab-close"
                    aria-label={`Close ${tab.label}`}
                    title={`Close ${tab.label}`}
                    onClick={() => closeTab(tab.id)}
                  >
                    <IconX size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="desktop-terminal-tabs__add"
            aria-label="New terminal"
            title="New terminal"
            onClick={addTab}
          >
            <IconPlus size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="desktop-terminal-tabs__meta">
          <span>{selectedAgent.label}</span>
          {terminalApp ? <span>{terminalApp.name}</span> : null}
        </div>
      </header>

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
          tabs.map((tab) => (
            <div
              key={`${tab.id}:${selectedAgent.id}`}
              className={`desktop-terminal-tabs__pane${tab.id === activeTabId ? " is-active" : ""}`}
              aria-hidden={tab.id !== activeTabId}
            >
              <AgentTerminal
                command={selectedAgent.command}
                wsUrl={connection.wsUrl}
                hideInFrame={false}
                className="desktop-terminal-tabs__terminal"
                theme={{
                  background: terminalBackground,
                  cursor: theme === "dark" ? "#d4d4d4" : "#4b5563",
                  foreground: theme === "dark" ? "#e5e7eb" : "#374151",
                }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
