import type { AgentTerminalSubmitRequest } from "@agent-native/core/terminal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@agent-native/toolkit/ui";
import type { AppConfig } from "@shared/app-registry";
import {
  IconDotsVertical,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

import { type DesktopTerminalAgentId } from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";

export interface DesktopTerminalPromptRequest extends AgentTerminalSubmitRequest {}

interface DesktopTerminalSurfaceProps {
  apps: readonly AppConfig[];
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
  submitRequest?: AgentTerminalSubmitRequest;
  onPromptSubmitted?: (request: AgentTerminalSubmitRequest) => void;
  onTerminalModeChange: (enabled: boolean) => void;
}

interface DesktopTerminalTab {
  id: string;
  label: string;
}

function createTerminalTab(number: number): DesktopTerminalTab {
  return {
    id: `desktop-terminal-${number}`,
    label: `Terminal ${number}`,
  };
}

export default function DesktopTerminalSurface({
  apps,
  agent,
  theme,
  className,
  submitRequest,
  onPromptSubmitted,
  onTerminalModeChange,
}: DesktopTerminalSurfaceProps) {
  const tabCounter = useRef(1);
  const [tabs, setTabs] = useState<DesktopTerminalTab[]>(() => [
    createTerminalTab(1),
  ]);
  const [activeTabId, setActiveTabId] = useState("desktop-terminal-1");
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const addTab = useCallback(() => {
    const next = createTerminalTab(++tabCounter.current);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length === 1) {
          const replacement = createTerminalTab(++tabCounter.current);
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
    [activeTabId],
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
    const replacement = createTerminalTab(++tabCounter.current);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
  }, []);

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
          <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                aria-label="Add terminal"
                title="Add terminal"
              >
                <IconPlus size={14} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-56 p-1"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[12px] font-medium text-foreground hover:bg-accent/60"
                onClick={() => {
                  addTab();
                  setAddMenuOpen(false);
                }}
              >
                <IconTerminal2
                  size={14}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>New terminal</span>
              </button>
              <div className="my-1 border-t border-border/70" />
              <div className="flex items-center justify-between gap-3 px-2.5 py-2">
                <span className="text-[12px] font-medium text-foreground">
                  Terminal mode
                </span>
                <Switch
                  checked
                  onCheckedChange={onTerminalModeChange}
                  aria-label="Terminal mode"
                />
              </div>
            </PopoverContent>
          </Popover>
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
              apps={apps}
              agent={agent}
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
