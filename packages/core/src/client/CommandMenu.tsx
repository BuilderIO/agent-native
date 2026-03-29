/**
 * CommandMenu — reusable command palette with agent chat fallback.
 *
 * Features:
 * - Anchored to top of viewport (not centered)
 * - Falls back to agent chat when no command matches
 * - Opens agent sidebar automatically when sending prompts
 * - Customizable commands via children
 *
 * Usage:
 *   <CommandMenu open={open} onOpenChange={setOpen}>
 *     <CommandMenu.Group heading="Actions">
 *       <CommandMenu.Item onSelect={() => doThing()}>Do thing</CommandMenu.Item>
 *     </CommandMenu.Group>
 *   </CommandMenu>
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { sendToAgentChat } from "./agent-chat.js";
import { cn } from "./utils.js";

// ─── Context ────────────────────────────────────────────────────────────────

interface CommandMenuContextValue {
  search: string;
  onOpenChange: (open: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setSelectedIndex: (index: number) => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function useCommandMenuContext() {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error("CommandMenu.* must be used inside <CommandMenu>");
  return ctx;
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Opens the agent sidebar (dispatches event that AgentSidebar listens for)
 */
export function openAgentSidebar() {
  window.dispatchEvent(new Event("agent-panel:open"));
}

/**
 * Sends a prompt to the agent and opens the sidebar
 */
export function submitToAgent(message: string) {
  openAgentSidebar();
  sendToAgentChat({ message, submit: true });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CommandGroupProps {
  heading?: string;
  children: ReactNode;
}

function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <div className="overflow-hidden p-1 text-foreground">
      {heading && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

interface CommandItemProps {
  onSelect: () => void;
  children: ReactNode;
  keywords?: string[];
  className?: string;
}

function CommandItem({
  onSelect,
  children,
  keywords: _keywords,
  className,
}: CommandItemProps) {
  const { onOpenChange, containerRef, setSelectedIndex } =
    useCommandMenuContext();
  const itemRef = useRef<HTMLDivElement>(null);

  const handleSelect = () => {
    onOpenChange(false);
    // Small delay to let dialog close animation start
    setTimeout(onSelect, 50);
  };

  const handleMouseEnter = () => {
    if (!containerRef.current || !itemRef.current) return;
    const items = containerRef.current.querySelectorAll('[role="option"]');
    const index = Array.from(items).indexOf(itemRef.current);
    if (index >= 0) setSelectedIndex(index);
  };

  return (
    <div
      ref={itemRef}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        className,
      )}
      onClick={handleSelect}
      onMouseEnter={handleMouseEnter}
      role="option"
    >
      {children}
    </div>
  );
}

interface CommandShortcutProps {
  children: ReactNode;
  className?: string;
}

function CommandShortcut({ children, className }: CommandShortcutProps) {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function CommandSeparator({ className }: { className?: string }) {
  return <div className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Text shown when no results match (before showing agent fallback) */
  emptyText?: string;
  /** Whether to show the "Ask AI" fallback when no commands match. Default: true */
  showAgentFallback?: boolean;
  /** Custom class for the dialog content */
  className?: string;
}

export function CommandMenu({
  open,
  onOpenChange,
  children,
  placeholder = "Type a command or ask AI...",
  emptyText = "No commands found.",
  showAgentFallback = true,
  className,
}: CommandMenuProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIndex(0);
      // Wait for render then focus
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Keep selected item scrolled into view
  useEffect(() => {
    const items = containerRef.current?.querySelectorAll('[role="option"]');
    if (items && items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Apply selected styling directly (can't rely on Tailwind scanning core package)
  useEffect(() => {
    const items = containerRef.current?.querySelectorAll('[role="option"]');
    if (!items) return;
    items.forEach((item, i) => {
      const el = item as HTMLElement;
      if (i === selectedIndex) {
        el.style.backgroundColor = "var(--accent)";
        el.style.color = "var(--accent-foreground)";
      } else {
        el.style.backgroundColor = "";
        el.style.color = "";
      }
    });
  });

  // Close on escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    // Use capture to handle clicks before they bubble
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open, onOpenChange]);

  const handleSubmitToAgent = useCallback(() => {
    if (!search.trim()) return;
    onOpenChange(false);
    submitToAgent(search.trim());
  }, [search, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = containerRef.current?.querySelectorAll('[role="option"]');
    const itemCount = items?.length ?? 0;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % itemCount || 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + itemCount) % itemCount || 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items && items[selectedIndex]) {
        (items[selectedIndex] as HTMLElement).click();
      }
    }
  };

  if (!open) return null;

  // Filter children based on search
  const filterChildren = (nodes: ReactNode): ReactNode => {
    return React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;

      // If it's a CommandGroup, filter its children
      if (child.type === CommandGroup) {
        const groupChildren = filterChildren(child.props.children);
        const hasChildren = React.Children.count(groupChildren) > 0;
        if (!hasChildren) return null;
        return React.cloneElement(child, {
          ...child.props,
          children: groupChildren,
        });
      }

      // If it's a CommandItem, check if it matches search
      if (child.type === CommandItem) {
        if (!search) return child;
        const text = getTextContent(child.props.children).toLowerCase();
        const keywords = (child.props.keywords || []).join(" ").toLowerCase();
        const searchLower = search.toLowerCase();
        if (text.includes(searchLower) || keywords.includes(searchLower)) {
          return child;
        }
        return null;
      }

      // If it's a separator, keep it (will be cleaned up later if needed)
      if (child.type === CommandSeparator) {
        return search ? null : child; // Hide separators when searching
      }

      return child;
    });
  };

  const filteredChildren = filterChildren(children);
  const hasResults = React.Children.toArray(filteredChildren).some(
    (child) => React.isValidElement(child) && child.type === CommandGroup,
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div
        ref={containerRef}
        className={cn(
          "fixed left-1/2 top-[5vh] -translate-x-1/2 w-full max-w-lg",
          "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
          className,
        )}
      >
        <CommandMenuContext.Provider
          value={{ search, onOpenChange, containerRef, setSelectedIndex }}
        >
          {/* Search input */}
          <div className="flex items-center border-b px-3">
            <SearchIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Command list */}
          <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
            {hasResults && filteredChildren}

            {/* Ask AI — always visible at the bottom */}
            {showAgentFallback && (
              <>
                {hasResults && <CommandSeparator />}
                <div className="p-1">
                  <div
                    className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none"
                    onClick={handleSubmitToAgent}
                    onMouseEnter={(e) => {
                      const items =
                        containerRef.current?.querySelectorAll(
                          '[role="option"]',
                        );
                      if (!items) return;
                      const index = Array.from(items).indexOf(e.currentTarget);
                      if (index >= 0) setSelectedIndex(index);
                    }}
                    role="option"
                  >
                    <MessageIcon className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {search.trim() ? (
                        <>
                          Ask AI:{" "}
                          <span className="text-muted-foreground">
                            "{search}"
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Ask AI anything...
                        </span>
                      )}
                    </span>
                    {search.trim() && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        ↵
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CommandMenuContext.Provider>
      </div>
    </div>
  );
}

// Helper to extract text content from React children
function getTextContent(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) {
    return children.map(getTextContent).join(" ");
  }
  if (React.isValidElement(children) && children.props.children) {
    return getTextContent(children.props.children);
  }
  return "";
}

// Attach sub-components
CommandMenu.Group = CommandGroup;
CommandMenu.Item = CommandItem;
CommandMenu.Shortcut = CommandShortcut;
CommandMenu.Separator = CommandSeparator;

// ─── Keyboard Hook ──────────────────────────────────────────────────────────

/**
 * Hook to handle Cmd+K (or Ctrl+K) to open the command menu
 */
export function useCommandMenuShortcut(onOpen: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Don't trigger if user is typing in an input/textarea
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpen]);
}

export type { CommandGroupProps, CommandItemProps, CommandShortcutProps };
