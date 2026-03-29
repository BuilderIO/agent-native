/**
 * AgentPanel — unified agent component with chat and CLI terminal modes.
 *
 * A self-contained panel with no layout opinions — drop it into a sidebar,
 * popover, dialog, full page, or any container. It fills its parent via
 * flex and min-h-0.
 *
 * Features:
 * - Chat mode: assistant-ui powered chat with tool calls
 * - CLI mode: embedded xterm.js terminal (dev mode only)
 * - Toggle between modes via header buttons
 *
 * Usage:
 *   // In a sidebar
 *   <div style={{ width: 380 }}><AgentPanel /></div>
 *
 *   // In a popover
 *   <Popover><AgentPanel suggestions={[...]} /></Popover>
 *
 *   // Full page
 *   <AgentPanel className="h-screen" />
 */

import ReactDOM from "react-dom";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import { useDevMode } from "./use-dev-mode.js";
import { cn } from "./utils.js";

// Lazy-load AgentTerminal to avoid bundling xterm.js when not needed
const AgentTerminal = lazy(() =>
  import("./terminal/index.js").then((m) => ({ default: m.AgentTerminal })),
);

// Lazy-load ResourcesPanel to avoid bundling when not needed
const ResourcesPanel = lazy(() =>
  import("./resources/ResourcesPanel.js").then((m) => ({
    default: m.ResourcesPanel,
  })),
);

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "builder";
const AGENT_PANEL_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const AGENT_PANEL_ROOT_STYLE = {
  fontFamily: AGENT_PANEL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
} satisfies React.CSSProperties;
const AGENT_PANEL_HEADER_CLASS =
  "relative z-[240] flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border";
const AGENT_PANEL_HEADER_STYLE = {
  paddingLeft: 12,
  paddingRight: 8,
} satisfies React.CSSProperties;
const AGENT_PANEL_CONTROL_STYLE = {
  fontSize: 12,
  lineHeight: 1,
} satisfies React.CSSProperties;

interface AvailableCli {
  command: string;
  label: string;
  available: boolean;
}

function useAvailableClis() {
  const [clis, setClis] = useState<AvailableCli[]>([]);
  useEffect(() => {
    // Try to fetch available CLIs — endpoint is provided by the terminal plugin.
    // Returns 404 gracefully when the plugin isn't loaded.
    fetch("/api/available-clis")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClis(data))
      .catch(() => {});
  }, []);
  return clis;
}

function useCliSelection() {
  const [selected, setSelected] = useState(CLI_DEFAULT);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CLI_STORAGE_KEY);
      if (saved) setSelected(saved);
    } catch {}
  }, []);
  const select = (cmd: string) => {
    setSelected(cmd);
    try {
      localStorage.setItem(CLI_STORAGE_KEY, cmd);
    } catch {}
  };
  return [selected, select] as const;
}

// Detect dev mode at build time (Vite replaces this)
const IS_DEV: boolean =
  typeof import.meta !== "undefined" &&
  typeof (import.meta as any).env !== "undefined" &&
  (import.meta as any).env.DEV === true;

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

interface SettingsSelectOption {
  value: string;
  label: string;
  description?: string;
}

function SettingsSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-foreground">{label}</p>
      <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
        <SelectPrimitive.Trigger
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 data-[placeholder]:text-muted-foreground"
          aria-label={label}
          style={AGENT_PANEL_CONTROL_STYLE}
        >
          <SelectPrimitive.Value>
            {selected?.label ?? value}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-[9999] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex w-full cursor-pointer select-none items-start gap-2 rounded-md px-8 py-2.5 text-[12px] outline-none data-[highlighted]:bg-accent/60 data-[state=checked]:bg-accent/40"
                  style={AGENT_PANEL_CONTROL_STYLE}
                >
                  <span className="absolute left-2 top-2.5 flex h-4 w-4 items-center justify-center text-muted-foreground">
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="h-3.5 w-3.5" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>
                      <span className="text-foreground">{option.label}</span>
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </div>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function IconTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="bottom"
            sideOffset={8}
            className="z-[230] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-popover" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// ─── Agent Settings Popover ──────────────────────────────────────────────────

function AgentSettingsPopover({
  isDevMode,
  onToggle,
  availableClis,
  selectedCli,
  onSelectCli,
}: {
  isDevMode: boolean;
  onToggle: () => void;
  availableClis: AvailableCli[];
  selectedCli: string;
  onSelectCli: (command: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Ignore clicks inside the popover itself or its trigger button
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      // Ignore clicks inside portaled Radix Select content (rendered outside the popover DOM)
      if (
        (target as Element).closest?.(
          "[data-radix-popper-content-wrapper], [data-radix-select-viewport], [role='listbox']",
        )
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const environmentOptions: SettingsSelectOption[] = [
    {
      value: "production",
      label: "Production",
      description: "Restricted to app tools only.",
    },
    {
      value: "development",
      label: "Development",
      description: "Full access to code editing, shell, and files.",
    },
  ];
  const cliOptions: SettingsSelectOption[] = availableClis.map((cli) => ({
    value: cli.command,
    label: cli.label,
  }));

  // Compute fixed position from the button so the popover escapes all
  // stacking contexts (the CLI terminal otherwise paints over it).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
          open && "bg-accent/50 text-foreground",
        )}
        title="Agent settings"
      >
        <CogIcon className="h-3.5 w-3.5" />
      </button>
      {open &&
        pos &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9990] w-72 rounded-lg border border-border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="space-y-3 p-3">
              <SettingsSelect
                label="Environment"
                value={isDevMode ? "development" : "production"}
                options={environmentOptions}
                onValueChange={(next) => {
                  const nextIsDev = next === "development";
                  if (nextIsDev !== isDevMode) onToggle();
                }}
              />
              {isDevMode && cliOptions.length > 0 && (
                <SettingsSelect
                  label="CLI Agent"
                  value={selectedCli}
                  options={cliOptions}
                  onValueChange={onSelectCli}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── AgentPanel ─────────────────────────────────────────────────────────────

export interface AgentPanelProps extends Omit<
  AssistantChatProps,
  "onSwitchToCli"
> {
  /** Initial mode. Default: "chat" */
  defaultMode?: "chat" | "cli";
  /** CSS class for the outer container */
  className?: string;
  /** Called when the user clicks the collapse button. If provided, a collapse button appears in the header. */
  onCollapse?: () => void;
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function AgentPanel({
  defaultMode = "chat",
  className,
  apiUrl,
  emptyStateText,
  suggestions,
  showHeader = true,
  onCollapse,
}: AgentPanelProps) {
  const mounted = useClientOnly();
  const [mode, setMode] = useState<"chat" | "cli" | "resources">(() => {
    try {
      const saved = localStorage.getItem("agent-native-panel-mode");
      if (saved === "chat" || saved === "cli" || saved === "resources")
        return saved;
    } catch {}
    return defaultMode;
  });
  useEffect(() => {
    try {
      localStorage.setItem("agent-native-panel-mode", mode);
    } catch {}
  }, [mode]);
  const availableClis = useAvailableClis();
  const [selectedCli, selectCli] = useCliSelection();
  const selectedLabel =
    availableClis.find((c) => c.command === selectedCli)?.label || selectedCli;
  const { isDevMode, canToggle, setDevMode } = useDevMode(apiUrl);
  const isLocalhost =
    mounted &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1");
  const showDevToggle = canToggle && isLocalhost;

  const renderModeButtons = useCallback(
    (activeMode: "chat" | "cli" | "resources") => (
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => setMode("chat")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
            activeMode === "chat"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          title="Chat mode"
          style={AGENT_PANEL_CONTROL_STYLE}
        >
          <ChatBubbleIcon className="h-3.5 w-3.5" />
          Chat
        </button>
        {isDevMode && (
          <button
            onClick={() => setMode("cli")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
              activeMode === "cli"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title="CLI terminal mode"
            style={AGENT_PANEL_CONTROL_STYLE}
          >
            <TerminalIcon className="h-3.5 w-3.5" />
            CLI
          </button>
        )}
      </div>
    ),
    [isDevMode],
  );

  const renderHeaderActions = useCallback(
    () => (
      <div className="flex shrink-0 items-center gap-1.5">
        <IconTooltip content="Resources">
          <button
            onClick={() => setMode(mode === "resources" ? "chat" : "resources")}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
              mode === "resources" && "bg-accent/50 text-foreground",
            )}
          >
            <FolderIcon className="h-3.5 w-3.5" />
          </button>
        </IconTooltip>
        {showDevToggle && (
          <IconTooltip content="Agent settings">
            <div>
              <AgentSettingsPopover
                isDevMode={isDevMode}
                onToggle={() => setDevMode(!isDevMode)}
                availableClis={availableClis}
                selectedCli={selectedCli}
                onSelectCli={selectCli}
              />
            </div>
          </IconTooltip>
        )}
        {onCollapse && (
          <IconTooltip content="Collapse sidebar">
            <button
              onClick={onCollapse}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <SidebarIcon className="h-3.5 w-3.5" />
            </button>
          </IconTooltip>
        )}
      </div>
    ),
    [
      availableClis,
      isDevMode,
      mode,
      onCollapse,
      selectCli,
      selectedCli,
      setDevMode,
      showDevToggle,
    ],
  );

  const renderChatHeader = useCallback(
    ({
      tabs,
      activeTabId,
      setActiveTabId,
      addTab,
      closeTab,
    }: MultiTabAssistantChatHeaderProps) => (
      <div
        className={AGENT_PANEL_HEADER_CLASS}
        style={AGENT_PANEL_HEADER_STYLE}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {renderModeButtons(mode)}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            {tabs.length > 1 &&
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "agent-tab flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium leading-none cursor-pointer",
                    tab.id === activeTabId
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                  style={AGENT_PANEL_CONTROL_STYLE}
                >
                  <span>{tab.label}</span>
                  {tab.status === "running" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
                  )}
                  {tab.status === "completed" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={cn(
                      "agent-tab-close ml-0.5 flex h-3 w-3 items-center justify-center rounded-sm",
                      tab.id === activeTabId
                        ? "text-foreground/55 hover:bg-background/60 hover:text-foreground"
                        : "text-muted-foreground/65 hover:bg-accent hover:text-foreground",
                    )}
                    title={`Close chat ${tab.label}`}
                    aria-label={`Close chat ${tab.label}`}
                  >
                    <XIcon className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            <IconTooltip content="New chat">
              <button
                onClick={addTab}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-accent/40 hover:text-muted-foreground"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            </IconTooltip>
          </div>
        </div>
        {renderHeaderActions()}
      </div>
    ),
    [mode, renderHeaderActions, renderModeButtons],
  );

  const renderChatOverlay = useCallback(
    ({ activeTabMessageCount, addTab }: MultiTabAssistantChatHeaderProps) =>
      activeTabMessageCount > 0 ? (
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <IconTooltip content="New chat">
            <button
              onClick={addTab}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded text-muted-foreground/50 hover:bg-accent/40 hover:text-muted-foreground"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </IconTooltip>
        </div>
      ) : null,
    [],
  );

  return (
    <div
      className={cn(
        "agent-panel-root flex flex-1 flex-col min-h-0 h-full text-[13px] leading-[1.2] antialiased",
        className,
      )}
      style={AGENT_PANEL_ROOT_STYLE}
    >
      {/* Tailwind group-hover/tab doesn't work in core package — inject directly */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".agent-tab-close{opacity:0}.agent-tab:hover .agent-tab-close{opacity:1}",
        }}
      />
      {/* Chat view — always mounted to preserve state.
          Header (with tabs + mode buttons) is always visible.
          Chat content is hidden when CLI or resources mode is active.
          The wrapper collapses (no flex-1) when another mode is active
          so it only takes the height of its header. */}
      <div
        className={cn(
          "flex flex-col min-h-0",
          mode === "chat" ? "flex-1" : "shrink-0",
        )}
      >
        {mounted && (
          <MultiTabAssistantChat
            apiUrl={apiUrl}
            showHeader={false}
            renderHeader={showHeader ? renderChatHeader : undefined}
            renderOverlay={showHeader ? renderChatOverlay : undefined}
            contentHidden={mode !== "chat"}
            emptyStateText={emptyStateText}
            suggestions={suggestions}
            onSwitchToCli={isDevMode ? () => setMode("cli") : undefined}
          />
        )}
      </div>

      {/* CLI terminal — only rendered in dev mode */}
      {isDevMode && mode === "cli" && (
        <div className="flex-1 min-h-0 relative">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading terminal...
              </div>
            }
          >
            <AgentTerminal
              command={selectedCli}
              hideInHarness={false}
              className="h-full"
              style={{ background: "transparent" }}
            />
          </Suspense>
        </div>
      )}

      {/* Resources view */}
      {mode === "resources" && (
        <div className="flex-1 min-h-0">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading resources...
              </div>
            }
          >
            <ResourcesPanel />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ─── Resize handle ──────────────────────────────────────────────────────────

const SIDEBAR_STORAGE_KEY = "agent-native-sidebar-width";
const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 700;

function ResizeHandle({
  position,
  onDrag,
}: {
  position: "left" | "right";
  onDrag: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      // For a left sidebar, dragging right = wider (positive delta)
      // For a right sidebar, dragging left = wider (negative delta)
      onDrag(position === "left" ? delta : -delta);
    },
    [onDrag, position],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // 5px wide in layout — thin enough to look like a divider, wide enough
  // to grab. Border on the sidebar-facing edge is the visible 1px line.
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        "relative z-20 shrink-0 w-[5px] touch-none select-none transition-colors",
        position === "left"
          ? "border-l border-border hover:border-accent active:border-accent"
          : "border-r border-border hover:border-accent active:border-accent",
      )}
      style={{ cursor: "col-resize" }}
    />
  );
}

// ─── AgentSidebar — wraps content with a toggleable agent panel ─────────────

export interface AgentSidebarProps {
  children: React.ReactNode;
  /** Placeholder text for the empty chat state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Width of the agent sidebar. Default: 380 */
  sidebarWidth?: number;
  /** Which side the sidebar appears on. Default: "right" */
  position?: "left" | "right";
  /** Whether the sidebar starts open. Default: false */
  defaultOpen?: boolean;
}

/**
 * Wraps app content with a toggleable agent sidebar.
 * Use AgentToggleButton in your header to open/close it.
 */
export function AgentSidebar({
  children,
  emptyStateText = "How can I help you?",
  suggestions,
  sidebarWidth = 380,
  position = "right",
  defaultOpen = false,
}: AgentSidebarProps) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (saved !== null) return saved === "true";
    } catch {}
    return defaultOpen;
  });
  const [width, setWidth] = useState(sidebarWidth);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) setWidth(n);
      }
    } catch {}
  }, []);

  const setOpenPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpen((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(SIDEBAR_OPEN_KEY, String(value));
        } catch {}
        return value;
      });
    },
    [],
  );

  useEffect(() => {
    const toggleHandler = () => {
      setOpenPersisted((prev) => !prev);
    };
    const openHandler = () => {
      setOpenPersisted(true);
    };
    window.addEventListener("agent-panel:toggle", toggleHandler);
    window.addEventListener("agent-panel:open", openHandler);
    return () => {
      window.removeEventListener("agent-panel:toggle", toggleHandler);
      window.removeEventListener("agent-panel:open", openHandler);
    };
  }, [setOpenPersisted]);

  // Cmd+I / Ctrl+I to focus the agent chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        focusAgentChat();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleDrag = useCallback((delta: number) => {
    setWidth((prev) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, prev + delta));
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const isLeft = position === "left";

  const sidebar = (
    <>
      {isLeft ? null : <ResizeHandle position={position} onDrag={handleDrag} />}
      <div
        className="agent-sidebar-panel flex shrink-0 flex-col overflow-hidden text-[13px] leading-[1.2] antialiased"
        style={{ ...AGENT_PANEL_ROOT_STYLE, width }}
      >
        <AgentPanel
          emptyStateText={emptyStateText}
          suggestions={suggestions}
          onCollapse={() => setOpenPersisted(false)}
        />
      </div>
      {isLeft ? <ResizeHandle position={position} onDrag={handleDrag} /> : null}
    </>
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {isLeft && open ? sidebar : null}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
      {!isLeft && open ? sidebar : null}
    </div>
  );
}

/**
 * Focus the agent chat composer input.
 * Opens the sidebar if closed, then focuses the text input.
 */
export function focusAgentChat() {
  window.dispatchEvent(new Event("agent-panel:open"));
  // Wait for sidebar to render, then focus the composer
  requestAnimationFrame(() => {
    const panel = document.querySelector(".agent-sidebar-panel");
    if (!panel) return;
    const prosemirror = panel.querySelector(
      ".ProseMirror",
    ) as HTMLElement | null;
    if (prosemirror) {
      prosemirror.focus();
      return;
    }
    const textarea = panel.querySelector("textarea") as HTMLElement | null;
    if (textarea) textarea.focus();
  });
}

/**
 * Button to toggle the agent sidebar. Place this in your app's header/toolbar.
 * Dispatches a custom event that AgentSidebar listens for.
 */
export function AgentToggleButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
        className,
      )}
      title="Toggle agent"
    >
      <ChatBubbleIcon className="h-4 w-4" />
    </button>
  );
}
