import { AgentTerminal } from "@agent-native/core/client";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@agent-native/toolkit/ui";
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
        if (current.length === 1) {
          const replacement = createTerminalTab();
          setActiveTabId(replacement.id);
          return [replacement];
        }
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

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((current) => {
      const tab = current.find((candidate) => candidate.id === tabId);
      if (!tab) return current;
      setActiveTabId(tab.id);
      return [tab];
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    const replacement = createTerminalTab();
    setTabs([replacement]);
    setActiveTabId(replacement.id);
  }, []);

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
      <div
        className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1"
        data-agent-terminal-tab-bar
      >
        <div
          className="agent-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label="Terminal tabs"
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId;
            const nextIndex = (offset: number) =>
              (index + offset + tabs.length) % tabs.length;
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`agent-tab group relative flex max-w-[130px] shrink-0 items-center rounded-md text-[11px] font-medium${active ? " bg-accent text-foreground ring-1 ring-inset ring-border/60 shadow-sm" : " text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}
                  >
                    <button
                      type="button"
                      role="tab"
                      tabIndex={active ? 0 : -1}
                      aria-selected={active}
                      className="flex min-w-0 flex-1 items-center px-2.5 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveTabId(tab.id);
                          return;
                        }
                        const targetIndex =
                          event.key === "ArrowRight"
                            ? nextIndex(1)
                            : event.key === "ArrowLeft"
                              ? nextIndex(-1)
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? tabs.length - 1
                                  : -1;
                        if (targetIndex < 0) return;
                        event.preventDefault();
                        const target = tabs[targetIndex];
                        if (!target) return;
                        setActiveTabId(target.id);
                        requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLElement>(
                              `[data-agent-terminal-tab-id="${CSS.escape(target.id)}"]`,
                            )
                            ?.focus();
                        });
                      }}
                      onClick={() => setActiveTabId(tab.id)}
                      data-agent-terminal-tab-id={tab.id}
                    >
                      <span className="truncate">{tab.label}</span>
                    </button>
                    <button
                      type="button"
                      className="agent-tab-close absolute inset-y-0 right-0 flex w-7 items-center justify-end rounded-r-md pe-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Close ${tab.label}`}
                      title={`Close ${tab.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <IconX size={10} aria-hidden="true" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                    Close
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length < 2}
                    onSelect={() => closeOtherTabs(tab.id)}
                  >
                    Close others
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={closeAllTabs}>
                    Close all
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground"
          aria-label="New terminal"
          title="New terminal"
          onClick={addTab}
        >
          <IconPlus size={14} aria-hidden="true" />
        </button>
      </div>

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
