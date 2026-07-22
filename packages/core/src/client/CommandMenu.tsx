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

import {
  Command as CommandPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandSeparator as CommandSeparatorPrimitive,
  CommandShortcut as CommandShortcutPrimitive,
} from "@agent-native/toolkit/ui/command";
import {
  IconBook2,
  IconExternalLink,
  IconMessage,
  IconHistory,
} from "@tabler/icons-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { parseChangelog } from "../changelog/parse.js";
import { sendToAgentChat } from "./agent-chat.js";
import { ChangelogDialog, useChangelogSeen } from "./changelog/Changelog.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { cn } from "./utils.js";

// ─── Context ────────────────────────────────────────────────────────────────

interface CommandMenuContextValue {
  search: string;
  onOpenChange: (open: boolean) => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function useCommandMenuContext() {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error("CommandMenu.* must be used inside <CommandMenu>");
  return ctx;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Opens the agent sidebar (dispatches event that AgentSidebar listens for)
 */
export function openAgentSidebar() {
  window.dispatchEvent(new Event("agent-panel:open"));
}

export function openAgentSettings(
  section?: string | { section?: string | null },
) {
  if (typeof window === "undefined") return;

  const normalizedSection =
    typeof section === "string" ? section : section?.section;

  const secretHash = normalizedSection?.replace(/^#/, "");
  if (secretHash?.toLowerCase().startsWith("secrets:")) {
    window.location.hash = `#${secretHash}`;
  }

  openAgentSidebar();
  // Voice mode unmounts the chat surface while its dock is collapsed, so its
  // settings listener does not exist until opening the sidebar remounts it.
  // Deliver after the open-state render can commit instead of racing React's
  // concurrent remount. Non-visual runtimes fall back to the next task.
  const dispatchSettings = () => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: normalizedSection ? { section: normalizedSection } : undefined,
      }),
    );
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(dispatchSettings);
  } else {
    window.setTimeout(dispatchSettings, 0);
  }
}

export function focusAgentChat() {
  window.dispatchEvent(
    new CustomEvent("agent-panel:set-mode", {
      detail: { mode: "chat" },
    }),
  );
  openAgentSidebar();
}

/**
 * Sends a prompt to the agent and opens the sidebar
 */
export function submitToAgent(message: string) {
  focusAgentChat();
  sendToAgentChat({ message, submit: true });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CommandGroupProps {
  heading?: string;
  children: ReactNode;
}

function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <CommandGroupPrimitive heading={heading}>{children}</CommandGroupPrimitive>
  );
}

interface CommandItemProps {
  onSelect: () => void;
  children: ReactNode;
  keywords?: string[];
  className?: string;
  deferSelect?: boolean;
}

function CommandItem({
  onSelect,
  children,
  keywords: _keywords,
  className,
  deferSelect = true,
}: CommandItemProps) {
  const { onOpenChange } = useCommandMenuContext();

  const handleSelect = () => {
    if (!deferSelect) {
      onSelect();
      onOpenChange(false);
      return;
    }

    onOpenChange(false);
    // Small delay to let dialog close animation start
    setTimeout(onSelect, 50);
  };

  return (
    <CommandItemPrimitive
      className={cn("cursor-pointer gap-2", className)}
      onSelect={handleSelect}
    >
      {children}
    </CommandItemPrimitive>
  );
}

interface CommandShortcutProps {
  children: ReactNode;
  className?: string;
}

function CommandShortcut({ children, className }: CommandShortcutProps) {
  return (
    <CommandShortcutPrimitive className={className}>
      {children}
    </CommandShortcutPrimitive>
  );
}

function CommandSeparator({ className }: { className?: string }) {
  return <CommandSeparatorPrimitive className={cn("my-1", className)} />;
}

export interface CommandMenuDoc {
  title: string;
  href: string;
  description?: string;
  keywords?: string[];
}

interface CommandDocsGroupProps {
  docs: CommandMenuDoc[];
  heading?: string;
}

function commandDocSearchText(doc: CommandMenuDoc): string {
  return [doc.title, doc.description, ...(doc.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterCommandDocs(docs: CommandMenuDoc[], search: string) {
  const searchLower = search.trim().toLowerCase();
  if (!searchLower) return docs;
  return docs.filter((doc) => commandDocSearchText(doc).includes(searchLower));
}

function openDocsHref(href: string) {
  if (/^https?:\/\//i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.assign(href);
}

function CommandDocsGroup({ docs, heading = "Docs" }: CommandDocsGroupProps) {
  if (docs.length === 0) return null;

  return (
    <CommandGroup heading={heading}>
      {docs.map((doc) => (
        <CommandItem
          key={doc.href}
          onSelect={() => openDocsHref(doc.href)}
          keywords={[doc.title, doc.description ?? "", ...(doc.keywords ?? [])]}
          deferSelect={false}
          className="items-start py-2"
        >
          <IconBook2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{doc.title}</span>
            {doc.description ? (
              <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                {doc.description}
              </span>
            ) : null}
          </span>
          <IconExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Render app-specific dynamic results from the current search value. */
  renderResults?: (search: string) => ReactNode;
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Text shown when no results match (before showing agent fallback) */
  emptyText?: string;
  /** Whether to show the "Ask AI" fallback when no commands match. Default: true */
  showAgentFallback?: boolean;
  /** Custom class for the dialog content */
  className?: string;
  /**
   * Raw CHANGELOG.md contents. When provided, the menu shows a built-in
   * "What's new" entry that opens an in-app changelog dialog (with an unseen
   * dot for new releases). Pass your app's own file:
   *   import changelog from "../CHANGELOG.md?raw";
   *   <CommandMenu ... changelog={changelog} />
   */
  changelog?: string;
  /** Label for the built-in changelog entry. Default: "What's new". */
  changelogLabel?: string;
  /**
   * Stable key used to remember which release a user has already seen (for the
   * unseen dot). Defaults to the document title's host app; set explicitly when
   * multiple apps share an origin.
   */
  changelogKey?: string;
}

export function CommandMenu({
  open,
  onOpenChange,
  children,
  renderResults,
  placeholder = "Type a command or ask AI...",
  emptyText: _emptyText = "No commands found.",
  showAgentFallback = true,
  className,
  changelog,
  changelogLabel = "What's new",
  changelogKey,
}: CommandMenuProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Built-in "What's new" changelog surface (only active when `changelog` is
  // passed). The dialog is rendered alongside the menu so it survives the menu
  // closing; the unseen dot persists per browser via localStorage.
  const [changelogOpen, setChangelogOpen] = useState(false);
  const hasChangelog =
    typeof changelog === "string" && changelog.trim().length > 0;
  const changelogEntries = useMemo(
    () => (hasChangelog ? parseChangelog(changelog as string) : []),
    [hasChangelog, changelog],
  );
  const latestChangelogId = changelogEntries[0]?.id;
  const { unseen: changelogUnseen, markSeen: markChangelogSeen } =
    useChangelogSeen(changelogKey ?? "app", latestChangelogId);

  const openChangelog = useCallback(() => {
    onOpenChange(false);
    markChangelogSeen();
    // Let the menu close before the dialog opens (avoids overlay flicker).
    setTimeout(() => setChangelogOpen(true), 50);
  }, [onOpenChange, markChangelogSeen]);

  // Focus input when opening; clear search while closed so reopen never renders
  // dynamic results for the previous query.
  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }

    if (open) {
      setSearch("");
      // Wait for render then focus
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const handleSubmitToAgent = useCallback(() => {
    onOpenChange(false);
    if (!search.trim()) {
      focusAgentChat();
      return;
    }
    submitToAgent(search.trim());
  }, [search, onOpenChange]);

  // The built-in "What's new" row matches changelog-ish search terms.
  const changelogRowMatches =
    !search ||
    [
      changelogLabel,
      "changelog",
      "what's new",
      "whats new",
      "updates",
      "release notes",
      "changes",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  const showChangelogRow = hasChangelog && changelogRowMatches;

  // Filter children based on search
  const filterChildren = (nodes: ReactNode): ReactNode => {
    return React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;
      const props = child.props as Record<string, unknown>;

      // If it's a CommandGroup, filter its children
      if (child.type === CommandGroup) {
        const groupChildren = filterChildren(props.children as ReactNode);
        const hasChildren = React.Children.count(groupChildren) > 0;
        if (!hasChildren) return null;
        return React.cloneElement(child, {
          ...props,
          children: groupChildren,
        } as Record<string, unknown>);
      }

      if (child.type === CommandDocsGroup) {
        const docs = Array.isArray(props.docs)
          ? (props.docs as CommandMenuDoc[])
          : [];
        const filteredDocs = filterCommandDocs(docs, search);
        if (filteredDocs.length === 0) return null;
        return React.cloneElement(child, {
          ...props,
          docs: filteredDocs,
        } as Record<string, unknown>);
      }

      // If it's a CommandItem, check if it matches search
      if (child.type === CommandItem) {
        if (!search) return child;
        const text = getTextContent(props.children as ReactNode).toLowerCase();
        const keywords = ((props.keywords as string[]) || [])
          .join(" ")
          .toLowerCase();
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
    (child) =>
      React.isValidElement(child) &&
      (child.type === CommandGroup || child.type === CommandDocsGroup),
  );
  const dynamicResults = open ? renderResults?.(search) : null;
  const hasDynamicResults = Boolean(dynamicResults);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          ref={containerRef}
          aria-describedby={undefined}
          hideClose
          motion="instant"
          overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-none transition-none"
          overlayStyle={{
            zIndex: 50,
            backgroundColor: "rgb(0 0 0 / 0.5)",
            backdropFilter: "none",
            animation: "none",
            transition: "none",
          }}
          className={cn(
            "fixed left-1/2 top-[15vh] -translate-x-1/2 w-full max-w-lg",
            "rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
            className,
          )}
          style={{
            top: "15vh",
            zIndex: 50,
            maxHeight: "none",
            width: "100%",
            maxWidth: "32rem",
            transform: "translateX(-50%)",
            gap: 0,
            padding: 0,
            backgroundColor: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
            animation: "none",
            transition: "none",
          }}
        >
          <DialogTitle className="sr-only">{placeholder}</DialogTitle>
          <CommandPrimitive
            loop
            shouldFilter={false}
            className="h-auto rounded-lg"
          >
            <CommandMenuContext.Provider value={{ search, onOpenChange }}>
              {/* Search input */}
              <CommandInputPrimitive
                ref={inputRef}
                value={search}
                onValueChange={setSearch}
                placeholder={placeholder}
              />

              {/* Command list */}
              <CommandListPrimitive>
                {dynamicResults}
                {hasResults && filteredChildren}

                {/* What's new — built-in changelog entry */}
                {showChangelogRow && (
                  <>
                    {hasResults && <CommandSeparator />}
                    <div className="p-1">
                      <CommandItemPrimitive
                        className="cursor-pointer gap-2 py-2"
                        onSelect={openChangelog}
                      >
                        <IconHistory className="h-4 w-4 text-muted-foreground" />
                        <span>{changelogLabel}</span>
                        {changelogUnseen && (
                          <span
                            className="ms-auto h-2 w-2 rounded-full bg-primary"
                            aria-label="New updates available"
                          />
                        )}
                      </CommandItemPrimitive>
                    </div>
                  </>
                )}

                {/* Ask AI — always visible at the bottom */}
                {showAgentFallback && (
                  <>
                    {(hasResults || showChangelogRow || hasDynamicResults) && (
                      <CommandSeparator />
                    )}
                    <div className="p-1">
                      <CommandItemPrimitive
                        className="cursor-pointer gap-2 py-2"
                        onSelect={handleSubmitToAgent}
                      >
                        <IconMessage className="h-4 w-4 text-muted-foreground" />
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
                          <span className="ms-auto text-xs text-muted-foreground">
                            ↵
                          </span>
                        )}
                      </CommandItemPrimitive>
                    </div>
                  </>
                )}
              </CommandListPrimitive>
            </CommandMenuContext.Provider>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>

      {hasChangelog && (
        <ChangelogDialog
          open={changelogOpen}
          onOpenChange={setChangelogOpen}
          markdown={changelog as string}
          title={changelogLabel}
        />
      )}
    </>
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
  if (
    React.isValidElement(children) &&
    (children.props as Record<string, unknown>).children
  ) {
    return getTextContent(
      (children.props as Record<string, unknown>).children as ReactNode,
    );
  }
  return "";
}

// Attach sub-components
CommandMenu.Group = CommandGroup;
CommandMenu.Item = CommandItem;
CommandMenu.DocsGroup = CommandDocsGroup;
CommandMenu.Shortcut = CommandShortcut;
CommandMenu.Separator = CommandSeparator;

// ─── Keyboard Hook ──────────────────────────────────────────────────────────

/**
 * Hook to handle Cmd+K (or Ctrl+K) to open the command menu
 */
export function useCommandMenuShortcut(
  onOpen: () => void,
  options: { allowContentEditable?: boolean } = {},
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Don't trigger if user is typing in a native form control.
        const target = e.target instanceof HTMLElement ? e.target : null;
        const isContentEditable = target?.isContentEditable;
        if (
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.tagName === "SELECT" ||
          (!options.allowContentEditable && isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        onOpen();
      }
    };
    const useCapture = Boolean(options.allowContentEditable);
    document.addEventListener("keydown", handleKeyDown, useCapture);
    return () =>
      document.removeEventListener("keydown", handleKeyDown, useCapture);
  }, [onOpen, options.allowContentEditable]);
}

export type {
  CommandDocsGroupProps,
  CommandGroupProps,
  CommandItemProps,
  CommandShortcutProps,
};
