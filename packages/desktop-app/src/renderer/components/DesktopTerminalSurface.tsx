import type { AgentTerminalSubmitRequest } from "@agent-native/core/terminal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconCheck,
  IconDotsVertical,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

import {
  DESKTOP_TERMINAL_AGENT_OPTIONS,
  type DesktopTerminalAgentId,
} from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";
import { DesktopChatFirstSurfaceMenuItems } from "./DesktopChatFirstSurfaceMenu.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";

export interface DesktopTerminalPromptRequest extends AgentTerminalSubmitRequest {}

interface DesktopTerminalSurfaceProps {
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
  submitRequest?: AgentTerminalSubmitRequest;
  onPromptSubmitted?: (request: AgentTerminalSubmitRequest) => void;
  onNewUiTab?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onAgentChange?: (agent: DesktopTerminalAgentId) => void;
}

interface DesktopTerminalTab {
  id: string;
  label: string;
  agent: DesktopTerminalAgentId;
}

function createTerminalTab(
  number: number,
  agent: DesktopTerminalAgentId,
): DesktopTerminalTab {
  return {
    id: `desktop-terminal-${number}`,
    label: `Terminal ${number}`,
    agent,
  };
}

export default function DesktopTerminalSurface({
  agent,
  theme,
  className,
  submitRequest,
  onPromptSubmitted,
  onNewUiTab,
  sidebarOpen,
  onToggleSidebar,
  onAgentChange,
}: DesktopTerminalSurfaceProps) {
  const tabCounter = useRef(1);
  const [tabs, setTabs] = useState<DesktopTerminalTab[]>(() => [
    createTerminalTab(1, agent),
  ]);
  const [activeTabId, setActiveTabId] = useState("desktop-terminal-1");

  const addTab = useCallback(() => {
    const next = createTerminalTab(++tabCounter.current, agent);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, [agent]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length === 1) {
          const replacement = createTerminalTab(++tabCounter.current, agent);
          setActiveTabId(replacement.id);
          return [replacement];
        }
        const index = current.findIndex((tab) => tab.id === tabId);
        if (index < 0) return current;
        const next = current.filter((tab) => tab.id !== tabId);
        if (tabId === activeTabId) {
          setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "");
        }
        return next;
      });
    },
    [activeTabId, agent],
  );

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((current) => {
      const target = current.find((tab) => tab.id === tabId);
      if (!target) return current;
      setActiveTabId(target.id);
      return [target];
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    const replacement = createTerminalTab(++tabCounter.current, agent);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
  }, [agent]);

  const handleAgentChange = useCallback(
    (nextAgent: DesktopTerminalAgentId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeTabId ? { ...tab, agent: nextAgent } : tab,
        ),
      );
      onAgentChange?.(nextAgent);
    },
    [activeTabId, onAgentChange],
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <section
      className={["desktop-terminal-surface", className]
        .filter(Boolean)
        .join(" ")}
      data-desktop-terminal-surface
    >
      <div className="agent-native-shell-topbar desktop-terminal-surface__header">
        <div
          className="agent-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label="Terminal tabs"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={active}
                data-desktop-terminal-tab={tab.id}
                className={`agent-tab relative flex max-w-[150px] shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                onClick={() => setActiveTabId(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveTabId(tab.id);
                  }
                }}
              >
                <span className="truncate pe-1">{tab.label}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <IconX size={10} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            aria-label="New terminal"
            title="New terminal"
            onClick={addTab}
          >
            <IconPlus size={14} aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                aria-label="Terminal options"
                title="Terminal options"
              >
                <IconDotsVertical size={14} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-48">
              {onAgentChange ? (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                      <IconTerminal2 size={14} className="shrink-0" />
                      Provider
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      {DESKTOP_TERMINAL_AGENT_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.id}
                          onSelect={() => handleAgentChange(option.id)}
                        >
                          <IconCheck
                            size={14}
                            className={
                              option.id === (activeTab?.agent ?? agent)
                                ? "shrink-0"
                                : "invisible"
                            }
                            aria-hidden="true"
                          />
                          <span>{option.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {onToggleSidebar || onNewUiTab ? (
                <>
                  <DesktopChatFirstSurfaceMenuItems
                    sidebarOpen={sidebarOpen}
                    onToggleSidebar={onToggleSidebar}
                    onNewUiTab={onNewUiTab}
                  />
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => closeTab(activeTabId)}>
                Close terminal
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={tabs.length < 2}
                onSelect={() => closeOtherTabs(activeTabId)}
              >
                Close other terminals
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={closeAllTabs}>
                Close all terminals
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="desktop-terminal-surface__body">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="desktop-terminal-surface__tab-content"
            aria-hidden={tab.id !== activeTabId}
            hidden={tab.id !== activeTabId}
          >
            <DesktopTerminalTabs
              agent={tab.agent}
              theme={theme}
              submitRequest={tab.id === activeTabId ? submitRequest : undefined}
              onPromptSubmitted={onPromptSubmitted}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
